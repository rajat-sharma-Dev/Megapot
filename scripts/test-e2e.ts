/**
 * End-to-end test.
 *
 *   npm run test:e2e
 *
 * Boots the real production server and drives a complete player journey over
 * HTTP — entry fees, race creation, gameplay, server-side replay scoring, the
 * daily ladder, quitting, the day-close payout that mints real tickets against
 * live Base Sepolia contracts, and every abuse case the API has to reject.
 *
 * Nothing is mocked except the final broadcast (MEGAPOT_DRY_RUN), which still
 * simulates the transaction against live chain state.
 */

import { spawn, type ChildProcess } from 'child_process';
import { rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { driveRace } from './lib/drive';
import { simulateRace } from '../src/lib/game/replay';
import { ENTRIES_PER_TICKET } from '../src/lib/vault/economy';

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(process.cwd(), '.data-e2e');

const PLAYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const THIRD = '0x3333333333333333333333333333333333333333';
const LEGACY = '0x4444444444444444444444444444444444444444';

/**
 * A player row exactly as an older build of this app wrote it.
 *
 * The store is a JSON file that outlives deploys, so it will hand back rows whose
 * shape predates the current code. When the ticket economy was replaced by the
 * daily ladder, `pointBank` became `credits` — and every money path did a bare
 * `BigInt(player.credits)`, which threw "Cannot convert undefined to a BigInt" on
 * the first race for anyone with an existing profile. This fixture reproduces
 * that file so the migration is proven rather than assumed.
 */
const LEGACY_DB = {
  players: {
    [LEGACY]: {
      id: LEGACY,
      name: 'Veteran',
      pointBank: 420,
      lifetimePoints: 1337,
      racesCompleted: 9,
      cookiePieces: 3,
      cookiesAwarded: 0,
      totalStolen: 4,
      ticketsEarned: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    },
  },
  races: {},
  tickets: [],
  orbRollover: 1,
};

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
    const res = await fetch(`${BASE}/api/leaderboard`, { signal: AbortSignal.timeout(2500) });
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
async function playRace(
  address: string,
  name: string,
  opts: { skill?: 'rookie' | 'steady' | 'sharp'; quitAtProgress?: number } = {},
) {
  const created = await api('POST', '/api/race/create', { address, name });
  if (created.status !== 200 || !created.json?.ok) {
    throw new Error(`race/create failed: ${created.status} ${JSON.stringify(created.json)}`);
  }

  const { raceId, seed } = created.json;
  const { inputs } = driveRace({
    seed, raceId, humanName: name,
    humanSkill: opts.skill ?? 'steady',
    quitAtProgress: opts.quitAtProgress,
  });

  const submitted = await api('POST', '/api/race/submit', { raceId, address, inputs });
  if (submitted.status !== 200 || !submitted.json?.ok) {
    throw new Error(`race/submit failed: ${submitted.status} ${JSON.stringify(submitted.json)}`);
  }

  return { raceId, seed, inputs, result: submitted.json, created: created.json };
}

let server: ChildProcess | null = null;

async function main() {
  console.log('\x1b[1m═══ Rally Vault · end-to-end ═══\x1b[0m');

  await rm(DATA_DIR, { recursive: true, force: true });

  // Seed a data file written by the previous schema, so the server has to migrate
  // it on load rather than crash on it.
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(path.join(DATA_DIR, 'rally-vault.json'), JSON.stringify(LEGACY_DB, null, 2));

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
  let ticketPriceUnits = 0n;
  {
    const { status, json } = await api('GET', '/api/jackpot');
    check(status === 200 && json?.ok, 'GET /api/jackpot returns live drawing state');
    if (json?.ok) {
      ticketPriceUnits = BigInt(json.ticketPrice);
      check(Number(json.drawingId) > 0, `reading drawing #${json.drawingId} from the chain`);
      check(ticketPriceUnits > 0n, `ticket price $${json.ticketPriceFormatted} read from the contract`);
      check(json.network === 'testnet', 'running against testnet — no real funds at risk');
      check(json.referralFeePct > 0, `referral fee ${json.referralFeePct.toFixed(1)}% confirmed on-chain`);
      check(json.jackpotLock === false, 'protocol is not mid-settlement');
    }
  }

  // ── Legacy data migration ────────────────────────────────────────────────
  group('A profile written by the old schema');
  {
    const prof = await api('GET', `/api/player?address=${LEGACY}`);
    check(prof.status === 200 && prof.json?.ok, 'a legacy player record loads instead of throwing');

    if (prof.json?.ok) {
      const p = prof.json.player;
      check(typeof p.credits === 'string' && /^\d+$/.test(p.credits), `credits backfilled to "${p.credits}"`);
      check(p.lifetimePoints === 1337, 'points that already existed are preserved');
      check(p.racesCompleted === 9, 'and so is the race count');
      check(p.name === 'Veteran', 'and the name');
      check(p.bestRaceScore === 0, 'fields the old schema never had default to zero, not undefined');
      check(p.racesRetired === 0, 'including the DNF counter');
      check(prof.json.credits.entriesAffordable > 0, 'the daily grant applies, so they can play immediately');
    }

    // This is the exact call that used to throw on the first race.
    const created = await api('POST', '/api/race/create', { address: LEGACY, name: 'Veteran' });
    check(created.status === 200 && created.json?.ok, 'and starting a race works — no BigInt conversion crash');
    if (created.json?.ok) {
      check(BigInt(created.json.entry.feeUnits) > 0n, 'the entry fee was charged normally');
    }
  }

  // ── Input validation ─────────────────────────────────────────────────────
  group('Input validation');
  {
    check((await api('POST', '/api/race/create', { address: 'nope' })).status === 400, 'rejects a malformed wallet address');
    check((await api('GET', '/api/player?address=nope')).status === 400, 'player lookup rejects a bad address');
    check((await api('GET', '/api/tickets?address=nope')).status === 400, 'ticket lookup rejects a bad address');
    check((await api('POST', '/api/race/submit', { raceId: 'x', address: PLAYER })).status === 400, 'submit requires an input log');
    const unknown = await api('POST', '/api/race/submit', {
      raceId: 'deadbeefdeadbeefdeadbeef', address: PLAYER, inputs: { lateral: [], boostRuns: [], quitTick: null },
    });
    check(unknown.status === 404, 'submit rejects an unknown race id');
  }

  // ── Entry fee economics ──────────────────────────────────────────────────
  group('Entry fee and the day pool');
  let entryFeeUnits = 0n;
  {
    const before = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    check(before.ok, 'a new player is created on first profile read');
    check(Number(before.credits.entriesAffordable) > 0, `granted ${before.credits.entriesAffordable} free entries for the day`);

    const creditsBefore = BigInt(before.player.credits);
    const created = await api('POST', '/api/race/create', { address: PLAYER, name: 'Tester' });
    entryFeeUnits = BigInt(created.json.entry.feeUnits);

    check(entryFeeUnits > 0n, `entry costs ${entryFeeUnits} base units`);
    check(
      entryFeeUnits * ENTRIES_PER_TICKET === ticketPriceUnits,
      `which is exactly a fifth of the live ticket price (${ENTRIES_PER_TICKET} entries = 1 ticket)`,
    );
    check(
      BigInt(created.json.entry.creditsAfter) === creditsBefore - entryFeeUnits,
      'the fee is debited from the player, once',
    );
    check(BigInt(created.json.entry.poolUnits) >= entryFeeUnits, 'and credited into the day pool');
    check(typeof created.json.day.key === 'string', `race is stamped with vault day ${created.json.day.key}`);

    // Abandon this race (never submitted) — the fee is still spent, as it would be
    // for a player who closes the tab. That is deliberate: otherwise entries are free.
    const board = (await api('GET', '/api/leaderboard')).json;
    check(board.day.entries >= 1, `pool shows ${board.day.entries} entry/entries`);
    check(
      BigInt(board.day.entryFeeUnits) === entryFeeUnits,
      'the leaderboard reports the same entry fee the race charged',
    );
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
    check(r.retired === false, 'a completed race is not flagged as a DNF');
    check(r.breakdown.finish > 0, 'the finish bonus was paid');
    check(r.dayPoints === r.pointsAwarded, `today's ladder credited: ${r.dayPoints}`);
    check(r.dayRank === 1, 'and the player is ranked on it');
    check(r.dayRaces === 1, 'the race counted toward the day');
    check(r.isPersonalBest === true, 'a first race is a personal best');

    // No ticket per race — tickets are a once-a-day ladder payout.
    check(r.ticketsMinted === undefined, 'no ticket is minted per race');
  }

  // ── Quitting over HTTP ───────────────────────────────────────────────────
  group('Quitting mid-race');
  {
    const quit = await playRace(PLAYER, 'Tester', { quitAtProgress: 0.4 });
    const r = quit.result;

    check(r.retired === true, 'the server recognises a DNF from the input log alone');
    check(r.breakdown.finish === 0, 'finish bonus scores ZERO on a DNF');
    check(r.breakdown.podium === 0, 'podium scores ZERO on a DNF');
    check(r.breakdown.cleanRun === 0, 'clean-run bonus scores ZERO on a DNF');
    check(r.pointsAwarded >= 0, `still banked ${r.pointsAwarded} points for what was collected`);
    check(
      r.breakdown.progress > 0.3 && r.breakdown.progress < 1,
      `progress recorded at ${(r.breakdown.progress * 100).toFixed(0)}%`,
    );
    check(r.dayRaces === 2, 'a DNF still counts as a race for the day');

    // A quit must not be forgeable into a better result, and must be replayable.
    const local = simulateRace({
      seed: quit.seed, raceId: quit.raceId, humanName: 'Tester', inputs: quit.inputs,
    });
    const localMe = local.outcome.racers.find((x) => x.name === 'Tester')!;
    check(localMe.retired, 'an independent local replay of the log also shows the DNF');
  }

  // ── The server is the authority ──────────────────────────────────────────
  group('Anti-cheat');
  {
    // The server's outcome must equal an independent local replay of the same log.
    const local = simulateRace({
      seed: firstRace.seed, raceId: firstRace.raceId, humanName: 'Tester', inputs: firstRace.inputs,
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
    const { inputs } = driveRace({ seed: race.json.seed, raceId: race.json.raceId, humanName: 'Tester' });
    const spoofed = await api('POST', '/api/race/submit', {
      raceId: race.json.raceId, address: PLAYER, inputs,
      pointsAwarded: 999999, placement: 1, dayPoints: 999999,
    });
    check(
      spoofed.status === 200 && spoofed.json.pointsAwarded < 1000,
      `a client-supplied score is ignored — server awarded ${spoofed.json?.pointsAwarded}, not 999999`,
    );

    // An oversized log is refused rather than burning CPU.
    const huge = await api('POST', '/api/race/submit', {
      raceId: 'aaaaaaaaaaaaaaaaaaaaaaaa', address: PLAYER,
      inputs: { lateral: new Array(999_999).fill(0), boostRuns: [], quitTick: null },
    });
    check(huge.status === 400, 'an oversized input log is rejected before simulation');

    // Malformed boost runs must be clamped, not trusted — this is the one field
    // that indexes into a tick array on the server.
    const evil = await api('POST', '/api/race/create', { address: PLAYER, name: 'Tester' });
    const evilDrive = driveRace({ seed: evil.json.seed, raceId: evil.json.raceId, humanName: 'Tester' });
    const poisoned = await api('POST', '/api/race/submit', {
      raceId: evil.json.raceId, address: PLAYER,
      inputs: {
        ...evilDrive.inputs,
        boostRuns: [[-999, 1e9], [1e12, 1e12], ['x', null], [0], [NaN, NaN]],
      },
    });
    check(
      poisoned.status === 200 && typeof poisoned.json.pointsAwarded === 'number',
      'hostile boost-run encodings are clamped and scored without crashing',
    );

    const runsCap = await api('POST', '/api/race/submit', {
      raceId: 'bbbbbbbbbbbbbbbbbbbbbbbb', address: PLAYER,
      inputs: { lateral: [], boostRuns: new Array(99_999).fill([0, 1]), quitTick: null },
    });
    check(runsCap.status === 400, 'an absurd number of boost runs is rejected');
  }

  // ── The daily ladder ─────────────────────────────────────────────────────
  group('The daily ladder');
  {
    // Build a real three-way board with different scores.
    for (let i = 0; i < 4; i++) await playRace(PLAYER, 'Tester', { skill: 'sharp' });
    for (let i = 0; i < 2; i++) await playRace(OTHER, 'Rival', { skill: 'steady' });
    await playRace(THIRD, 'Tail', { skill: 'rookie' });

    const board = (await api('GET', '/api/leaderboard')).json;
    check(board.ok, 'GET /api/leaderboard responds');
    check(board.today.length === 3, `three players on today's board`);

    const points = board.today.map((r: any) => r.points);
    check(
      points.every((p: number, i: number) => i === 0 || p <= points[i - 1]),
      'the board is sorted by points, descending',
    );
    check(
      board.today.every((r: any, i: number) => r.rank === i + 1),
      'ranks are dense and start at 1',
    );

    const totalPoints = board.today.reduce((s: number, r: any) => s + r.points, 0);
    check(totalPoints > 0, `${totalPoints} points scored across the day`);

    // The pool must equal entries × fee, and the projection must match it.
    const expectedPool = entryFeeUnits * BigInt(board.day.entries);
    check(
      BigInt(board.day.poolUnits) === expectedPool,
      `pool is exactly entries × fee (${board.day.entries} × ${entryFeeUnits})`,
    );
    check(
      board.day.projectedTickets === Number(expectedPool / ticketPriceUnits),
      `projects ${board.day.projectedTickets} ticket(s) from the pool`,
    );

    const projected = board.today.reduce((s: number, r: any) => s + r.projectedTickets, 0);
    check(
      projected === board.day.projectedTickets,
      'per-player projections sum to exactly the pool’s ticket count',
    );
    if (board.day.projectedTickets > 0) {
      check(board.today[0].projectedTickets > 0, 'the leader is projected at least one ticket');
    }

    // Per-player view agrees with the board.
    const mine = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    const myRow = board.today.find((r: any) => r.address === PLAYER);
    check(mine.today.rank === myRow.rank, `player endpoint agrees on rank #${mine.today.rank}`);
    check(mine.today.points === myRow.points, 'and on points');
    check(mine.today.projectedTickets === myRow.projectedTickets, 'and on projected tickets');
    check(mine.today.players === 3, 'and on the size of the field');
  }

  // ── Day close → real tickets ─────────────────────────────────────────────
  group('Day close → real Megapot tickets');
  {
    const board = (await api('GET', '/api/leaderboard')).json;
    const dayKey = board.day.key;
    const expectTickets = board.day.projectedTickets;

    // An open day must refuse to settle without force — otherwise a payout could
    // fire while people are still climbing.
    const premature = await api('POST', '/api/day/settle', { key: dayKey });
    check(premature.status === 409, 'settling an open day is refused without force');

    const settled = await api('POST', '/api/day/settle', { key: dayKey, force: true });
    check(settled.status === 200 && settled.json.ok, 'forcing the close settles the day');

    const day = settled.json.settled[0];
    check(day.key === dayKey, `settled vault day ${dayKey}`);
    check(day.ticketsBought === expectTickets, `bought ${day.ticketsBought} ticket(s), matching the projection`);

    const paid = day.allocations.filter((a: any) => a.tickets > 0);
    check(
      day.allocations.reduce((s: number, a: any) => s + a.tickets, 0) === expectTickets,
      'allocations account for every ticket the pool bought',
    );
    check(paid.every((a: any) => !a.error), 'no allocation errored');
    check(paid.every((a: any) => /^0x[0-9a-f]{64}$/i.test(a.txHash)), 'each paid allocation has a transaction hash');
    if (paid.length > 0) {
      check(paid[0].rank === 1, 'the top of the ladder was paid first');
    }

    // Idempotency: settling twice must not mint twice.
    const again = await api('POST', '/api/day/settle', { key: dayKey, force: true });
    check(
      again.status === 200 && again.json.settled[0].ticketsBought === day.ticketsBought,
      'settling an already-settled day is idempotent — no double mint',
    );

    // The winner's tickets are now visible on their profile and via the API.
    if (paid.length > 0) {
      const winner = paid[0].playerId;
      const tickets = (await api('GET', `/api/tickets?address=${winner}`)).json;
      check(tickets.ok && tickets.local.length > 0, `winner's ticket list is populated`);
      check(
        tickets.local.every((t: any) => typeof t.explorerUrl === 'string' && t.explorerUrl.includes('basescan')),
        'every ticket carries a block-explorer link',
      );
      check(tickets.local[0].dayKey === dayKey, 'the ticket records which vault day paid for it');
      check(tickets.local[0].rank >= 1, `and the rank that earned it (#${tickets.local[0].rank})`);
      check(Number(tickets.local[0].drawingId) > 0, `bought into live drawing #${tickets.local[0].drawingId}`);
      check(tickets.onchainError === null, "Megapot's Data API was reachable for the on-chain cross-check");

      const profile = (await api('GET', `/api/player?address=${winner}`)).json;
      check(profile.player.ticketsEarned === tickets.totalTickets, 'ticket count on the profile matches the records');
    }

    // The remainder has to survive into tomorrow rather than vanish.
    const carry = BigInt(day.carryOutUnits);
    check(
      carry === BigInt(board.day.poolUnits) - ticketPriceUnits * BigInt(expectTickets),
      `unspent ${carry} base units carried forward, nothing lost`,
    );
  }

  // ── Isolation ────────────────────────────────────────────────────────────
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
    check(
      BigInt(a.credits) === BigInt(beforeA.credits),
      "and only that player's credits are spent",
    );
  }

  // ── Out of credits ───────────────────────────────────────────────────────
  group('Running out of entries');
  {
    // Burn the daily allowance and confirm the door closes cleanly rather than
    // letting anyone enter the pool for free.
    let guard = 0;
    let status = 200;
    while (status === 200 && guard++ < 60) {
      status = (await api('POST', '/api/race/create', { address: THIRD, name: 'Tail' })).status;
    }
    check(status === 402, 'once the allowance is spent, race creation returns 402 Payment Required');

    const profile = (await api('GET', `/api/player?address=${THIRD}`)).json;
    check(profile.credits.entriesAffordable === 0, 'and the profile reports zero entries affordable');
    check(BigInt(profile.player.credits) < entryFeeUnits, 'with a balance below one entry fee');
  }

  // ── Pages render ─────────────────────────────────────────────────────────
  group('Pages');
  for (const [route, marker] of [
    ['/', 'Rally Vault'],
    ['/race', 'Ready up'],
    ['/leaderboard', 'ladder'],
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
