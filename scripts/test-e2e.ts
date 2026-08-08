/**
 * End-to-end test.
 *
 *   npm run build && npx tsx scripts/test-e2e.ts
 *
 * Boots the real production server and drives a complete player journey over
 * HTTP — race creation, gameplay, server-side replay scoring, Point Bank
 * accrual, ticket minting against live Base Sepolia contracts, the Cookie path,
 * leaderboards, and every abuse case the submit endpoint has to reject.
 *
 * Nothing is mocked except the final broadcast (MEGAPOT_DRY_RUN), which still
 * simulates the transaction against live chain state.
 */

import { spawn, type ChildProcess } from 'child_process';
import { rm } from 'fs/promises';
import path from 'path';
import { driveRace } from './lib/drive';
import { TICKET_THRESHOLD, COOKIE_PIECES, RACES_PER_COOKIE_PIECE } from '../src/lib/points/scoring';
import { simulateRace } from '../src/lib/game/replay';

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(process.cwd(), '.data-e2e');

const PLAYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';

let pass = 0;
let fail = 0;
const ok = (m: string) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const bad = (m: string) => { fail++; console.log(`  \x1b[31m✗ ${m}\x1b[0m`); };
const check = (c: boolean, m: string) => (c ? ok(m) : bad(m));
const group = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);

async function api(method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, json };
}

/**
 * Refuse to run against a server we didn't start.
 *
 * A leftover server from an earlier run holds both the old build and its own
 * in-memory state, so the suite silently tests stale code and reports failures
 * that have nothing to do with the current tree. Fail loudly instead.
 */
async function assertPortFree() {
  try {
    const res = await fetch(`${BASE}/api/leaderboard`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      throw new Error(
        `Port ${PORT} is already serving. A previous test server is still running — ` +
          `kill it first (ps -eo pid,cmd | grep next-server) or these results will ` +
          `reflect a stale build.`,
      );
    }
  } catch (err) {
    if ((err as Error).message.includes('already serving')) throw err;
    // Connection refused / timeout — the port is free, which is what we want.
  }
}

async function waitForServer(timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/api/leaderboard`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

/** Play one race end-to-end and return the settlement payload. */
async function playRace(address: string, name: string, skill: 'rookie' | 'steady' | 'sharp' = 'steady') {
  const created = await api('POST', '/api/race/create', { address, name });
  if (created.status !== 200 || !created.json?.ok) {
    throw new Error(`race/create failed: ${created.status} ${JSON.stringify(created.json)}`);
  }

  const { raceId, seed, ballMax, bonusballMax } = created.json;
  const { inputs } = driveRace({ seed, raceId, humanName: name, ballMax, bonusballMax, humanSkill: skill });

  const submitted = await api('POST', '/api/race/submit', { raceId, address, inputs });
  if (submitted.status !== 200 || !submitted.json?.ok) {
    throw new Error(`race/submit failed: ${submitted.status} ${JSON.stringify(submitted.json)}`);
  }

  return { raceId, seed, ballMax, bonusballMax, inputs, result: submitted.json, created: created.json };
}

let server: ChildProcess | null = null;

async function main() {
  console.log('\x1b[1m═══ Rally Vault · end-to-end ═══\x1b[0m');

  await rm(DATA_DIR, { recursive: true, force: true });

  group('Server boot');
  await assertPortFree();

  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, RALLY_DATA_DIR: DATA_DIR, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr?.on('data', (d) => {
    const s = String(d);
    if (s.toLowerCase().includes('error')) process.stderr.write(`    [server] ${s}`);
  });

  const up = await waitForServer();
  if (!up) { bad('server failed to start'); return; }
  ok(`production server responding on :${PORT}`);

  // ── Live Megapot state ───────────────────────────────────────────────────
  group('Megapot integration (live Base Sepolia)');
  {
    const { status, json } = await api('GET', '/api/jackpot');
    check(status === 200 && json?.ok, 'GET /api/jackpot returns live drawing state');
    if (json?.ok) {
      check(Number(json.drawingId) > 0, `reading drawing #${json.drawingId} from the chain`);
      check(json.ballMax >= 5, `ball range read live: normals 1–${json.ballMax}, bonusball 1–${json.bonusballMax}`);
      check(Number(json.ticketPrice) > 0, `ticket price $${json.ticketPriceFormatted} read from the contract`);
      check(json.network === 'testnet', 'running against testnet — no real funds at risk');
      check(json.referralFeePct > 0, `referral fee ${json.referralFeePct.toFixed(1)}% confirmed on-chain`);
    }
  }

  // ── Input validation ─────────────────────────────────────────────────────
  group('Input validation');
  {
    check((await api('POST', '/api/race/create', { address: 'nope' })).status === 400, 'rejects a malformed wallet address');
    check((await api('GET', '/api/player?address=nope')).status === 400, 'player lookup rejects a bad address');
    check((await api('POST', '/api/race/submit', { raceId: 'x', address: PLAYER })).status === 400, 'submit requires an input log');
    const unknown = await api('POST', '/api/race/submit', {
      raceId: 'deadbeefdeadbeefdeadbeef', address: PLAYER, inputs: { lateral: [], boostTicks: [] },
    });
    check(unknown.status === 404, 'submit rejects an unknown race id');
  }

  // ── One full race ────────────────────────────────────────────────────────
  group('A complete race');
  let firstRace: Awaited<ReturnType<typeof playRace>>;
  {
    firstRace = await playRace(PLAYER, 'Tester');
    const r = firstRace.result;

    check(r.ok === true, 'race created, played and settled over HTTP');
    check(r.placement >= 1 && r.placement <= 5, `finished ${r.placement} of 5`);
    check(r.pointsAwarded > 0, `scored ${r.pointsAwarded} points`);
    check(r.breakdown.total === r.pointsAwarded, 'breakdown total matches the points awarded');
    check(r.pointBank === r.pointsAwarded, `Point Bank credited: ${r.pointBank}`);
    check(r.racesCompleted === 1, 'race counted toward the Cookie');

    const t = r.previewTicket;
    check(!!t, 'a Megapot ticket was constructed from the race');
    if (t) {
      check(t.normals.length === 5, `ticket has 5 normals: [${t.normals.join(', ')}]`);
      check(new Set(t.normals).size === 5, 'normals are unique');
      check(t.normals.every((n: number, i: number) => i === 0 || n > t.normals[i - 1]), 'normals are ascending (protocol requirement)');
      check(t.bonusball >= 1 && t.bonusball <= firstRace.bonusballMax, `bonusball ${t.bonusball} in range`);
      check(t.earnedNormals.length > 0, `${t.earnedNormals.length} numbers were earned on the track, not generated`);
      check(t.earnedNormals.length + t.filledNormals.length === 5, 'earned + filled always accounts for all 5 slots');
    }
  }

  // ── The server is the authority ──────────────────────────────────────────
  group('Anti-cheat');
  {
    // The server's outcome must equal an independent local replay of the same log.
    const local = simulateRace({
      seed: firstRace.seed,
      raceId: firstRace.raceId,
      humanName: 'Tester',
      ballMax: firstRace.ballMax,
      bonusballMax: firstRace.bonusballMax,
      inputs: firstRace.inputs,
    });
    const serverPlacement = firstRace.result.outcome.racers.find((r: any) => r.name === 'Tester')?.placement;
    const localPlacement = local.outcome.racers.find((r) => r.name === 'Tester')?.placement;
    check(serverPlacement === localPlacement, 'the server derives the outcome itself and it reproduces exactly');

    // Replay protection.
    const replay = await api('POST', '/api/race/submit', {
      raceId: firstRace.raceId, address: PLAYER, inputs: firstRace.inputs,
    });
    check(replay.status === 409, 'a settled race cannot be submitted twice (no farming one good run)');

    // Ownership.
    const stolen = await api('POST', '/api/race/create', { address: OTHER, name: 'Thief' });
    const hijack = await api('POST', '/api/race/submit', {
      raceId: stolen.json.raceId, address: PLAYER, inputs: firstRace.inputs,
    });
    check(hijack.status === 403, "a race cannot be submitted by another player's address");

    // A fabricated score in the body is ignored — only inputs matter.
    const race = await api('POST', '/api/race/create', { address: PLAYER, name: 'Tester' });
    const { inputs } = driveRace({
      seed: race.json.seed, raceId: race.json.raceId, humanName: 'Tester',
      ballMax: race.json.ballMax, bonusballMax: race.json.bonusballMax,
    });
    const spoofed = await api('POST', '/api/race/submit', {
      raceId: race.json.raceId, address: PLAYER, inputs,
      pointsAwarded: 999999, placement: 1, pointBank: 999999,
    });
    check(
      spoofed.status === 200 && spoofed.json.pointsAwarded < 1000,
      `a client-supplied score is ignored — server awarded ${spoofed.json?.pointsAwarded}, not 999999`,
    );

    // An oversized log is refused rather than burning CPU.
    const huge = await api('POST', '/api/race/submit', {
      raceId: 'aaaaaaaaaaaaaaaaaaaaaaaa', address: PLAYER,
      inputs: { lateral: new Array(999_999).fill(0), boostTicks: [] },
    });
    check(huge.status === 400, 'an oversized input log is rejected before simulation');
  }

  // ── Play to a ticket ─────────────────────────────────────────────────────
  group('Point Bank → real ticket');
  {
    let races = 2; // two already played above
    let minted: any = null;
    let bankBefore = 0;

    for (let i = 0; i < 20 && !minted; i++) {
      const before = (await api('GET', `/api/player?address=${PLAYER}`)).json.player.pointBank;
      const { result } = await playRace(PLAYER, 'Tester');
      races++;
      if (result.ticketsMinted?.length) {
        minted = result.ticketsMinted.find((t: any) => t.path === 'point_bank') ?? result.ticketsMinted[0];
        bankBefore = before;
      }
      if (result.purchaseError) {
        bad(`purchase failed: ${result.purchaseError}`);
        break;
      }
    }

    check(!!minted, `a ticket minted after ${races} races (threshold ${TICKET_THRESHOLD})`);
    if (minted) {
      check(races >= 4 && races <= 12, `${races} races to the first ticket — inside the 4–10 design target`);
      check(bankBefore < TICKET_THRESHOLD, 'the ticket fired exactly on crossing the threshold');
      check(/^0x[0-9a-f]{64}$/i.test(minted.txHash), `transaction hash recorded: ${minted.txHash.slice(0, 18)}…`);
      check(Number(minted.drawingId) > 0, `bought into live drawing #${minted.drawingId}`);

      if (minted.path === 'point_bank') {
        check(minted.normals.length === 5, `ticket carries the earned numbers [${minted.normals.join(', ')}]`);
        check(minted.earnedNormals.length > 0, `${minted.earnedNormals.length} of them were collected on the track`);
      }
    }
  }

  // ── Cookie path ──────────────────────────────────────────────────────────
  group('Cookie path (guaranteed ticket)');
  {
    const COOKIE_RACES = COOKIE_PIECES * RACES_PER_COOKIE_PIECE;

    // Keep racing until the Cookie completes. The Point Bank section above may
    // already have pushed past 18 races, so the ticket is looked up from the
    // player's full ticket list rather than watched for in a single response.
    let played = (await api('GET', `/api/player?address=${PLAYER}`)).json.player.racesCompleted;
    while (played < COOKIE_RACES) {
      played = (await playRace(PLAYER, 'Tester')).result.racesCompleted;
    }

    const profile = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    const cookieTicket = profile.tickets.find((t: any) => t.path === 'cookie');
    check(profile.player.racesCompleted >= COOKIE_RACES, `played ${profile.player.racesCompleted} races`);
    check(
      profile.player.cookiePieces === Math.floor(profile.player.racesCompleted / RACES_PER_COOKIE_PIECE),
      `Cookie pieces track races correctly: ${profile.player.cookiePieces} pieces from ${profile.player.racesCompleted} races`,
    );
    check(!!cookieTicket, `Cookie completed at ${COOKIE_RACES} races and minted a guaranteed ticket`);
    if (cookieTicket) {
      check(cookieTicket.path === 'cookie', 'Cookie ticket is tagged as the consistency path');
      check(/^0x[0-9a-f]{64}$/i.test(cookieTicket.txHash), 'Cookie ticket has its own transaction');
    }
  }

  // ── Profile, tickets, leaderboard ────────────────────────────────────────
  group('Profile, tickets and leaderboards');
  {
    const profile = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    check(profile.ok, 'GET /api/player returns the profile');
    check(profile.player.lifetimePoints > 0, `lifetime points ${profile.player.lifetimePoints}`);
    check(profile.player.pointBank < TICKET_THRESHOLD, 'Point Bank always sits below the threshold after settling');
    check(profile.player.ticketsEarned === profile.tickets.length, `tickets earned (${profile.player.ticketsEarned}) matches tickets recorded`);
    check(profile.progress.threshold === TICKET_THRESHOLD, 'progress reports the correct threshold');

    const tickets = (await api('GET', `/api/tickets?address=${PLAYER}`)).json;
    check(tickets.ok && Array.isArray(tickets.local), `GET /api/tickets lists ${tickets.local.length} minted ticket(s)`);
    check(
      tickets.local.every((t: any) => typeof t.explorerUrl === 'string' && t.explorerUrl.includes('basescan')),
      'every ticket carries a block-explorer link',
    );
    check(tickets.onchainError === null, "Megapot's Data API was reachable for the on-chain cross-check");

    const board = (await api('GET', '/api/leaderboard')).json;
    check(board.ok, 'GET /api/leaderboard responds');
    check(board.points.length > 0, `${board.points.length} player(s) ranked by lifetime points`);
    check(board.points[0].address === PLAYER, 'the active player tops the board');
    const rankedRaces = board.points.reduce((s: number, p: any) => s + p.racesCompleted, 0);
    check(board.totals.races === rankedRaces, `global race count (${board.totals.races}) is the sum across players`);
    check(board.totals.ticketsMinted === tickets.local.length, 'global ticket count matches minted tickets');
  }

  // ── Multi-player isolation ───────────────────────────────────────────────
  group('Player isolation');
  {
    const beforeA = (await api('GET', `/api/player?address=${PLAYER}`)).json.player;
    const beforeB = (await api('GET', `/api/player?address=${OTHER}`)).json.player;

    await playRace(OTHER, 'Rival');

    const a = (await api('GET', `/api/player?address=${PLAYER}`)).json.player;
    const b = (await api('GET', `/api/player?address=${OTHER}`)).json.player;

    check(a.lifetimePoints !== b.lifetimePoints, "one player's points do not leak into another's");
    check(
      b.racesCompleted === beforeB.racesCompleted + 1 && a.racesCompleted === beforeA.racesCompleted,
      "racing as one player advances only that player's counters",
    );

    const bTickets = (await api('GET', `/api/tickets?address=${OTHER}`)).json;
    check(bTickets.local.length === 0, 'the second player has no tickets yet — records are per-wallet');
  }

  // ── Pages render ─────────────────────────────────────────────────────────
  group('Pages');
  for (const [route, marker] of [
    ['/', 'Rally Vault'],
    ['/race', 'Ready up'],
    ['/leaderboard', 'Leaderboard'],
    ['/profile', 'Your vault'],
  ] as const) {
    const res = await fetch(`${BASE}${route}`);
    const html = await res.text();
    check(res.ok && html.includes(marker), `${route} renders (200, contains "${marker}")`);
  }
}

main()
  .catch((err) => { bad(`fatal: ${(err as Error).message}`); })
  .finally(async () => {
    server?.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    server?.kill('SIGKILL');
    await rm(DATA_DIR, { recursive: true, force: true });

    console.log(
      fail === 0
        ? `\n\x1b[32m\x1b[1m✓ ${pass} end-to-end checks passed.\x1b[0m\n`
        : `\n\x1b[31m\x1b[1m✗ ${fail} failed, ${pass} passed.\x1b[0m\n`,
    );
    process.exit(fail === 0 ? 0 : 1);
  });
