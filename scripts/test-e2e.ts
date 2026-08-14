/**
 * End-to-end test.
 *
 *   npm run test:e2e
 *
 * Boots the real production server and drives a complete player journey over
 * HTTP — funding a balance, matchmaking into a lobby, racing, server-side replay
 * scoring, winner-take-all settlement, shards converting into a real Megapot
 * ticket against live Base Sepolia contracts, and every abuse case the API has
 * to reject.
 *
 * Nothing is mocked except the final broadcast (MEGAPOT_DRY_RUN), which still
 * simulates the transaction against live chain state.
 */

import { spawn, type ChildProcess } from 'child_process';
import { rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { driveRace, localField } from './lib/drive';
import { simulateLobby } from '../src/lib/game/replay';
import { scoreRace } from '../src/lib/points/scoring';
import { SEATS_PER_RACE } from '../src/lib/vault/economy';

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA_DIR = path.join(process.cwd(), '.data-e2e');

/** Short enough that the suite isn't mostly waiting, long enough to co-queue. */
const FILL_WINDOW_MS = 2500;

const PLAYER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const THIRD = '0x3333333333333333333333333333333333333333';
const LEGACY = '0x4444444444444444444444444444444444444444';

/**
 * A player row exactly as an older build of this app wrote it.
 *
 * The store is a JSON file that outlives deploys, so it will hand back rows whose
 * shape predates the current code. When the daily ladder was replaced by
 * winner-take-all pots, `credits` became `creditsUnits` — and every money path
 * does a bare `BigInt(...)` on it, which throws "Cannot convert undefined to a
 * BigInt" on the first race for anyone with an existing profile. This fixture
 * reproduces that file so the migration is proven rather than assumed.
 */
const LEGACY_DB = {
  players: {
    [LEGACY]: {
      id: LEGACY,
      name: 'Veteran',
      credits: '5000000',
      lifetimePoints: 1337,
      racesCompleted: 9,
      cookiePieces: 3,
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** API responses are checked by assertion, not by type — this is the test suite. */
type Json = ReturnType<typeof JSON.parse>;

async function api(method: string, pathname: string, body?: unknown) {
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: Json = null;
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
    const res = await fetch(`${BASE}/api/jackpot`, { signal: AbortSignal.timeout(2500) });
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
      const res = await fetch(`${BASE}/api/jackpot`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(600);
  }
  return false;
}

/** Fund a wallet through the dev faucet, which is what the suite has instead of USDC. */
async function fund(address: string) {
  const res = await api('POST', '/api/dev/faucet', { address });
  if (res.status !== 200) throw new Error(`faucet failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

/** Poll a lobby until it stops being open, so we can read its seed. */
async function waitForLock(lobbyId: string, address: string, timeoutMs = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { json } = await api('GET', `/api/lobby/${lobbyId}?address=${address}`);
    if (json?.ok && json.lobby.state !== 'open') return json.lobby;
    await sleep(300);
  }
  throw new Error(`lobby ${lobbyId} never locked`);
}

async function joinLobby(address: string, name: string) {
  const res = await api('POST', '/api/lobby/join', { address, name });
  if (res.status !== 200 || !res.json?.ok) {
    throw new Error(`lobby/join failed: ${res.status} ${JSON.stringify(res.json)}`);
  }
  return res.json;
}

/**
 * Keep a stand-in solvent.
 *
 * The faucet grants a fixed number of entries, and several groups play dozens of
 * races, so a long loop will eventually run the wallet dry and fail with a 402
 * that says nothing about the thing under test. Topping up on demand keeps a
 * funding artefact from masquerading as a product bug.
 *
 * Deliberately only used by `playRace`. The "running out of balance" group
 * drives `/api/lobby/join` directly precisely so it CAN go broke.
 */
async function ensureFunded(address: string) {
  const { json } = await api('GET', `/api/player?address=${address}`);
  if (json?.ok && json.balance.entriesAffordable < 1) await fund(address);
}

/** Play one solo race end-to-end and return everything the assertions need. */
async function playRace(
  address: string,
  name: string,
  opts: { skill?: 'rookie' | 'steady' | 'sharp'; quitAtProgress?: number } = {},
) {
  await ensureFunded(address);
  const joined = await joinLobby(address, name);
  const lobby = await waitForLock(joined.lobby.id, address);

  const { inputs } = driveRace({
    seed: lobby.seed,
    lobbyId: lobby.id,
    humanName: name,
    mySeat: lobby.mySeat,
    humanSkill: opts.skill ?? 'steady',
    quitAtProgress: opts.quitAtProgress,
  });

  const submitted = await api('POST', '/api/lobby/submit', { lobbyId: lobby.id, address, inputs });
  if (submitted.status !== 200 || !submitted.json?.ok) {
    throw new Error(`lobby/submit failed: ${submitted.status} ${JSON.stringify(submitted.json)}`);
  }

  return {
    lobbyId: lobby.id,
    seed: lobby.seed,
    mySeat: lobby.mySeat,
    inputs,
    lobby: submitted.json.lobby,
    settlement: submitted.json.lobby.settlement,
  };
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
    env: {
      ...process.env,
      RALLY_DATA_DIR: DATA_DIR,
      RALLY_DEV_FAUCET: 'true',
      RALLY_FILL_WINDOW_MS: String(FILL_WINDOW_MS),
      RALLY_SUBMIT_WINDOW_MS: '30000',
      // Set so the referral sweep exercises its 401 path rather than its
      // "feature disabled" 404. The suite never sends the correct value.
      RALLY_ADMIN_SECRET: 'e2e-secret-never-sent',
      NODE_ENV: 'production',
    },
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
  let entryFeeUnits = 0n;
  {
    const { status, json } = await api('GET', '/api/jackpot');
    check(status === 200 && json?.ok, 'GET /api/jackpot returns live drawing state');
    if (json?.ok) {
      ticketPriceUnits = BigInt(json.ticketPrice);
      entryFeeUnits = BigInt(json.economy.entryFeeUnits);

      check(Number(json.drawingId) > 0, `reading drawing #${json.drawingId} from the chain`);
      check(ticketPriceUnits > 0n, `ticket price $${json.ticketPriceFormatted} read from the contract`);
      check(json.network === 'testnet', 'running against testnet — no real funds at risk');
      check(json.referralFeePct > 0, `referral fee ${json.referralFeePct.toFixed(1)}% confirmed on-chain`);
      check(json.jackpotLock === false, 'protocol is not mid-settlement');

      check(
        entryFeeUnits * BigInt(SEATS_PER_RACE) === ticketPriceUnits,
        `entry is exactly a fifth of the live ticket price (${entryFeeUnits} × ${SEATS_PER_RACE} = ${ticketPriceUnits})`,
      );
      check(
        BigInt(json.economy.fullPotUnits) === ticketPriceUnits,
        'a full five-seat pot equals one whole ticket',
      );
      check(BigInt(json.economy.houseFloatUnits) > 0n, 'the house float is funded and can stake bot seats');
    }
  }

  // ── Legacy data migration ────────────────────────────────────────────────
  group('A profile written by the old schema');
  {
    const prof = await api('GET', `/api/player?address=${LEGACY}`);
    check(prof.status === 200 && prof.json?.ok, 'a legacy player record loads instead of throwing');

    if (prof.json?.ok) {
      const p = prof.json.player;
      check(
        /^\d+$/.test(prof.json.balance.creditsUnits) && BigInt(prof.json.balance.creditsUnits) === 5_000_000n,
        `the old "credits" field migrated to creditsUnits ("${prof.json.balance.creditsUnits}")`,
      );
      check(p.lifetimePoints === 1337, 'points that already existed are preserved');
      check(p.name === 'Veteran', 'and the name');
      check(p.ticketsEarned === 2, 'and the ticket count');
      check(p.bestRaceScore === 0, 'fields the old schema never had default to zero, not undefined');
      check(p.racesWon === 0, 'including the new pot-win counter');
      check(prof.json.vault.units === '0', 'and the shard vault starts empty rather than undefined');
    }

    // This is the exact call that used to throw on the first race.
    const joined = await api('POST', '/api/lobby/join', { address: LEGACY, name: 'Veteran' });
    check(joined.status === 200 && joined.json?.ok, 'and joining a lobby works — no BigInt conversion crash');
    if (joined.json?.ok) {
      check(BigInt(joined.json.entryFeeUnits) > 0n, 'the entry fee was charged normally');
    }
  }

  // ── Input validation ─────────────────────────────────────────────────────
  group('Input validation');
  {
    check((await api('POST', '/api/lobby/join', { address: 'nope' })).status === 400, 'join rejects a malformed wallet address');
    check((await api('GET', '/api/player?address=nope')).status === 400, 'player lookup rejects a bad address');
    check((await api('GET', '/api/tickets?address=nope')).status === 400, 'ticket lookup rejects a bad address');
    check((await api('POST', '/api/lobby/submit', { lobbyId: 'x', address: PLAYER })).status === 400, 'submit requires an input log');
    check((await api('GET', '/api/lobby/deadbeef')).status === 404, 'an unknown lobby is a 404');

    const unknown = await api('POST', '/api/lobby/submit', {
      lobbyId: 'deadbeefdeadbeefdeadbeef', address: PLAYER,
      inputs: { lateral: [], boostRuns: [], quitTick: null },
    });
    check(unknown.status === 404, 'submit rejects an unknown lobby id');

    check((await api('POST', '/api/withdraw', { address: PLAYER, amountUnits: 'x' })).status === 400, 'withdraw rejects a non-numeric amount');
    check((await api('POST', '/api/deposit', { address: PLAYER, txHash: 'nope' })).status === 400, 'deposit rejects a malformed transaction hash');
    const fakeTx = `0x${'ab'.repeat(32)}`;
    check(
      (await api('POST', '/api/deposit', { address: PLAYER, txHash: fakeTx })).status === 400,
      'deposit rejects a hash that is not on chain — an amount is never taken on trust',
    );
  }

  // ── Funding ──────────────────────────────────────────────────────────────
  group('Funding a balance');
  {
    const before = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    check(before.ok, 'a new player is created on first profile read');
    check(BigInt(before.balance.creditsUnits) === 0n, 'and starts with nothing — there is no free play');
    check(before.balance.entriesAffordable === 0, 'so they cannot afford an entry yet');

    const broke = await api('POST', '/api/lobby/join', { address: PLAYER, name: 'Tester' });
    check(broke.status === 402, 'joining with an empty balance is 402 Payment Required');
    check(broke.json?.code === 'INSUFFICIENT_FUNDS', 'with a machine-readable reason the UI can act on');

    const funded = await fund(PLAYER);
    check(BigInt(funded.creditsUnits) > 0n, `funded ${funded.creditsUnits} base units`);

    const after = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    check(after.balance.entriesAffordable >= 10, `now affords ${after.balance.entriesAffordable} entries`);
    check(after.ledger.length >= 1, 'and the credit is recorded in the ledger');
  }

  // ── Matchmaking ──────────────────────────────────────────────────────────
  group('Matchmaking');
  let firstRace: Awaited<ReturnType<typeof playRace>>;
  {
    const balanceBefore = BigInt((await api('GET', `/api/player?address=${PLAYER}`)).json.balance.creditsUnits);

    const joined = await joinLobby(PLAYER, 'Tester');
    check(joined.lobby.state === 'open', 'a fresh lobby opens and waits for other racers');
    check(joined.lobby.seed === null, 'the seed is withheld while the lobby is open — no scouting the track');
    check(joined.lobby.seats.length === SEATS_PER_RACE, `${SEATS_PER_RACE} seats in a lobby`);
    check(joined.lobby.mySeat !== null, `you are seated (seat ${joined.lobby.mySeat})`);
    check(joined.lobby.stakedSeats === 1, 'only your seat is staked so far');
    check(
      BigInt(joined.creditsAfter) === balanceBefore - entryFeeUnits,
      'the entry fee is debited once, on joining',
    );

    const locked = await waitForLock(joined.lobby.id, PLAYER);
    check(locked.state === 'locked', 'the fill window expires and the lobby locks');
    check(typeof locked.seed === 'number', 'and the seed is released only then');
    check(locked.seats.every((s: Json) => s.kind !== 'empty'), 'every empty seat was taken by the house');
    check(locked.bots === SEATS_PER_RACE - 1, `${SEATS_PER_RACE - 1} house seats filled the grid`);
    check(
      locked.stakedSeats === SEATS_PER_RACE,
      'and the house staked all of them — the pot is a whole ticket',
    );
    check(
      BigInt(locked.potUnits) === ticketPriceUnits,
      `pot is ${locked.potUnits}, exactly one ticket price`,
    );
    check(
      locked.seats.filter((s: Json) => s.kind === 'bot').every((s: Json) => !!s.skill && typeof s.botSeed === 'number'),
      'house seats publish their skill and seed so the client can render the same field',
    );
    check(
      locked.seats.every((s: Json) => s.address === null || s.isYou),
      "no seat exposes another player's wallet address",
    );

    // Now drive it.
    const { inputs } = driveRace({
      seed: locked.seed, lobbyId: locked.id, humanName: 'Tester', mySeat: locked.mySeat,
    });
    const submitted = await api('POST', '/api/lobby/submit', {
      lobbyId: locked.id, address: PLAYER, inputs,
    });
    check(submitted.status === 200 && submitted.json.ok, 'the run submits over HTTP');
    check(submitted.json.settled === true, 'and a one-human lobby settles immediately');

    firstRace = {
      lobbyId: locked.id, seed: locked.seed, mySeat: locked.mySeat, inputs,
      lobby: submitted.json.lobby, settlement: submitted.json.lobby.settlement,
    };
  }

  // ── Settlement ───────────────────────────────────────────────────────────
  group('Winner takes the pot');
  {
    const s = firstRace.settlement;
    check(!!s, 'the lobby carries a settlement');
    check(s.standings.length === SEATS_PER_RACE, 'every seat appears in the standings');
    check(
      s.standings.every((r: Json, i: number) => i === 0 || r.points <= s.standings[i - 1].points),
      'standings are sorted by score, descending',
    );
    check(s.standings.filter((r: Json) => r.isWinner).length === 1, 'exactly one winner');
    check(s.standings[0].isWinner, 'and it is the top scorer');
    check(BigInt(s.potUnits) === ticketPriceUnits, 'the whole pot was on the line');
    check(s.refunded === false, 'somebody scored, so nothing was refunded');

    const mine = firstRace.lobby.myBreakdown;
    check(!!mine && mine.total > 0, `your run scored ${mine?.total} points`);
    check(mine.retired === false, 'a completed race is not flagged as a DNF');
    check(mine.finish > 0, 'the finish bonus was paid');

    // The authoritative result must reproduce exactly from the log alone. In a
    // one-human lobby the client's local simulation IS the server's, so this is
    // an exact equality rather than an approximation.
    const local = simulateLobby({
      seed: firstRace.seed,
      seats: localField(firstRace.lobbyId, firstRace.mySeat, 'Tester').map((seat) =>
        seat.index === firstRace.mySeat ? { ...seat, inputs: firstRace.inputs } : seat,
      ),
    });
    const localScores = scoreRace(local.outcome, firstRace.lobby.rolloverCount);
    const localMine = localScores.find((x) => x.name === 'Tester')!;
    check(
      localMine.total === mine.total,
      `an independent local replay derives the identical score (${localMine.total})`,
    );

    const localWinner = [...localScores].sort((a, b) => b.total - a.total)[0];
    check(
      localWinner.name === (s.winnerName ?? ''),
      `and names the same winner (${localWinner.name})`,
    );
  }

  // ── Scoring, not finishing, decides it ───────────────────────────────────
  group('The pot follows the score, not the finish line');
  {
    // Over a run of races, look for the case the whole design turns on: the pot
    // going to somebody who did not cross the line first.
    let sawWinnerNotFirst = false;
    let sawFirstNotWinner = false;
    let races = 0;

    // Bounded at 10 rather than 6 for headroom: this needs at least one race
    // where the top scorer was not first across the line, which is common but
    // not guaranteed in any given handful.
    for (let i = 0; i < 10 && !(sawWinnerNotFirst && sawFirstNotWinner); i++) {
      const r = await playRace(PLAYER, 'Tester', { skill: i % 2 ? 'sharp' : 'steady' });
      races++;
      const st = r.settlement;
      const winner = st.standings.find((x: Json) => x.isWinner)!;
      const firstAcross = st.standings.find((x: Json) => x.placement === 1);
      if (winner.placement > 1) sawWinnerNotFirst = true;
      if (firstAcross && !firstAcross.isWinner) sawFirstNotWinner = true;
    }

    check(
      sawWinnerNotFirst && sawFirstNotWinner,
      `over ${races} races, a racer who was not first across the line took the pot`,
    );
  }

  // ── Quitting over HTTP ───────────────────────────────────────────────────
  group('Quitting mid-race');
  {
    const quit = await playRace(PLAYER, 'Tester', { quitAtProgress: 0.4 });
    const mine = quit.lobby.myBreakdown;

    check(mine.retired === true, 'the server recognises a DNF from the input log alone');
    check(mine.finish === 0, 'finish bonus scores ZERO on a DNF');
    check(mine.podium === 0, 'finish position scores ZERO on a DNF');
    check(mine.cleanRun === 0, 'clean-run bonus scores ZERO on a DNF');
    check(mine.total >= 0, `still banked ${mine.total} points for what was collected`);
    check(
      mine.progress > 0.3 && mine.progress < 1,
      `progress recorded at ${(mine.progress * 100).toFixed(0)}%`,
    );
    check(
      quit.settlement.winnerSeat !== quit.lobby.mySeat,
      'and quitting loses the pot — the forfeited bonuses are decisive',
    );
  }

  // ── Anti-cheat ───────────────────────────────────────────────────────────
  group('Anti-cheat');
  {
    // Replay protection.
    const replay = await api('POST', '/api/lobby/submit', {
      lobbyId: firstRace.lobbyId, address: PLAYER, inputs: firstRace.inputs,
    });
    check(replay.status === 409, 'a settled lobby cannot be submitted to twice (no farming one good run)');

    // Ownership.
    await fund(OTHER);
    const theirs = await joinLobby(OTHER, 'Rival');
    const theirLobby = await waitForLock(theirs.lobby.id, OTHER);
    const hijack = await api('POST', '/api/lobby/submit', {
      lobbyId: theirLobby.id, address: PLAYER, inputs: firstRace.inputs,
    });
    check(hijack.status === 403, "a seat cannot be submitted by another player's address");

    // A fabricated score in the body is ignored — only inputs matter.
    const spoofDrive = driveRace({
      seed: theirLobby.seed, lobbyId: theirLobby.id, humanName: 'Rival', mySeat: theirLobby.mySeat,
    });
    const spoofed = await api('POST', '/api/lobby/submit', {
      lobbyId: theirLobby.id, address: OTHER, inputs: spoofDrive.inputs,
      points: 999999, placement: 1, winner: true,
    });
    check(
      spoofed.status === 200 && spoofed.json.lobby.myBreakdown.total < 1000,
      `a client-supplied score is ignored — server awarded ${spoofed.json?.lobby?.myBreakdown?.total}, not 999999`,
    );

    // An oversized log is refused rather than burning CPU.
    const huge = await api('POST', '/api/lobby/submit', {
      lobbyId: 'aaaaaaaaaaaaaaaaaaaaaaaa', address: PLAYER,
      inputs: { lateral: new Array(999_999).fill(0), boostRuns: [], quitTick: null },
    });
    check(huge.status === 400, 'an oversized input log is rejected before simulation');

    const runsCap = await api('POST', '/api/lobby/submit', {
      lobbyId: 'bbbbbbbbbbbbbbbbbbbbbbbb', address: PLAYER,
      inputs: { lateral: [], boostRuns: new Array(99_999).fill([0, 1]), quitTick: null },
    });
    check(runsCap.status === 400, 'an absurd number of boost runs is rejected');

    // Malformed boost runs must be clamped, not trusted — this is the one field
    // that indexes into a tick array on the server.
    const evil = await joinLobby(PLAYER, 'Tester');
    const evilLobby = await waitForLock(evil.lobby.id, PLAYER);
    const evilDrive = driveRace({
      seed: evilLobby.seed, lobbyId: evilLobby.id, humanName: 'Tester', mySeat: evilLobby.mySeat,
    });
    const poisoned = await api('POST', '/api/lobby/submit', {
      lobbyId: evilLobby.id, address: PLAYER,
      inputs: {
        ...evilDrive.inputs,
        boostRuns: [[-999, 1e9], [1e12, 1e12], ['x', null], [0], [NaN, NaN]],
      },
    });
    check(
      poisoned.status === 200 && typeof poisoned.json.lobby.myBreakdown.total === 'number',
      'hostile boost-run encodings are clamped and scored without crashing',
    );
  }

  // ── Two humans in one lobby ──────────────────────────────────────────────
  group('A lobby with two paying humans');
  {
    await fund(THIRD);

    // Both joins land inside the same fill window, so they share a lobby.
    const a = await joinLobby(PLAYER, 'Tester');
    const b = await joinLobby(THIRD, 'Tail');

    check(a.lobby.id === b.lobby.id, 'two players queueing together land in the same lobby');

    if (a.lobby.id === b.lobby.id) {
      const locked = await waitForLock(a.lobby.id, PLAYER);
      check(locked.humans === 2, 'the lobby holds two human seats');
      check(locked.bots === SEATS_PER_RACE - 2, 'and the house takes the rest');

      const driveA = driveRace({
        seed: locked.seed, lobbyId: locked.id, humanName: 'Tester', mySeat: a.lobby.mySeat, humanSkill: 'sharp',
      });
      const first = await api('POST', '/api/lobby/submit', {
        lobbyId: locked.id, address: PLAYER, inputs: driveA.inputs,
      });
      check(
        first.status === 200 && first.json.settled === false,
        'the first submission does not settle — the lobby waits for the other seat',
      );

      const driveB = driveRace({
        seed: locked.seed, lobbyId: locked.id, humanName: 'Tail', mySeat: b.lobby.mySeat, humanSkill: 'rookie',
      });
      const second = await api('POST', '/api/lobby/submit', {
        lobbyId: locked.id, address: THIRD, inputs: driveB.inputs,
      });
      check(second.status === 200 && second.json.settled === true, 'the last submission settles the lobby');

      const st = second.json.lobby.settlement;
      check(BigInt(st.potUnits) === ticketPriceUnits, 'the pot is still one whole ticket');
      check(st.standings.length === SEATS_PER_RACE, 'and every seat is scored in one authoritative replay');
      check(
        st.standings.filter((r: Json) => r.kind === 'human').length === 2,
        'both humans appear in the standings',
      );
    }
  }

  // ── Shards → a real ticket ───────────────────────────────────────────────
  group('Shards convert into a real Megapot ticket');
  {
    /**
     * A win in a fully-staked lobby is five shards, which is a whole ticket, so
     * it should mint on the spot. Play until one lands.
     *
     * Two things here are load bearing, because the first version of this check
     * failed roughly one run in nine for no reason at all:
     *
     *  · The bound is 20, not 10. Against four house seats an evenly-matched
     *    player wins about one race in five, so ten attempts leave a ~11% chance
     *    of a spurious failure. Twenty puts it near 1%.
     *  · The stand-in drives 'rookie', which sounds wrong and is not. The bot
     *    ladder is tuned for SAFETY, not score — measured over 80 races each,
     *    rookie averages 160 points, steady 145 and sharp 132, because caution
     *    keeps a racer away from the pickup lines. This test wants the profile
     *    that scores highest, and that is rookie.
     */
    let won: Json = null;
    let attempts = 0;
    for (let i = 0; i < 20 && !won; i++) {
      attempts++;
      const r = await playRace(PLAYER, 'Tester', { skill: 'rookie' });
      if (r.settlement?.winnerSeat === r.lobby.mySeat) won = r;
    }

    check(!!won, `the player took a pot within ${attempts} race${attempts === 1 ? '' : 's'}`);

    if (won) {
      const st = won.settlement;
      check(st.stakedSeats === SEATS_PER_RACE, `won a fully-staked ${st.stakedSeats}-seat pot`);
      check(
        st.ticketsMinted === 1,
        `which is exactly one ticket, minted on the spot (minted ${st.ticketsMinted})`,
      );
      check(st.mintError === null, 'with no mint error');
      check(
        st.txHashes.length === 1 && /^0x[0-9a-f]{64}$/i.test(st.txHashes[0]),
        'and a well-formed transaction hash',
      );

      const tickets = (await api('GET', `/api/tickets?address=${PLAYER}`)).json;
      check(tickets.ok && tickets.local.length > 0, "the winner's ticket list is populated");
      check(
        tickets.local.every((t: Json) => typeof t.explorerUrl === 'string' && t.explorerUrl.includes('basescan')),
        'every ticket carries a block-explorer link',
      );
      check(tickets.local[0].lobbyId === won.lobbyId, 'the ticket records which race pot paid for it');
      check(Number(tickets.local[0].drawingId) > 0, `bought into live drawing #${tickets.local[0].drawingId}`);
      check(tickets.onchainError === null, "Megapot's Data API was reachable for the on-chain cross-check");

      const profile = (await api('GET', `/api/player?address=${PLAYER}`)).json;
      check(profile.player.ticketsEarned === tickets.totalTickets, 'ticket count on the profile matches the records');
      check(profile.player.racesWon >= 1, 'and the win is on their record');
      check(
        BigInt(profile.vault.units) < ticketPriceUnits,
        'the vault spent the shards rather than hoarding them',
      );
      check(
        profile.ledger.some((e: Json) => e.kind === 'ticket'),
        'and the ticket purchase is in the ledger',
      );
      check(
        profile.ledger.some((e: Json) => e.kind === 'win'),
        'alongside the pot win that funded it',
      );
    }
  }

  // ── Value conservation ───────────────────────────────────────────────────
  group('Nothing is created or destroyed');
  {
    const players = [PLAYER, OTHER, THIRD, LEGACY];
    const profiles = await Promise.all(
      players.map(async (p) => (await api('GET', `/api/player?address=${p}`)).json),
    );

    let staked = 0n;
    let held = 0n;
    let vaults = 0n;
    let ticketsMinted = 0;

    for (const p of profiles) {
      staked += BigInt(p.balance.lifetimeWageredUnits);
      held += BigInt(p.balance.creditsUnits);
      vaults += BigInt(p.vault.units);
      ticketsMinted += p.player.ticketsEarned;
    }
    // The legacy fixture claimed two tickets before this run began.
    ticketsMinted -= 2;

    const jackpot = (await api('GET', '/api/jackpot')).json;
    const floatNow = BigInt(jackpot.economy.houseFloatUnits);

    check(staked > 0n, `${staked} base units were staked across the run`);
    check(vaults >= 0n, `${vaults} base units still sit in shard vaults`);
    check(ticketsMinted > 0, `${ticketsMinted} real ticket(s) were bought with pot winnings`);

    // Every base unit that left a player's balance is now in exactly one of three
    // places: a shard vault, a Megapot ticket, or the house float. The float is
    // measured against its own starting point, which is the only number here we
    // did not observe directly.
    const spentOnTickets = BigInt(ticketsMinted) * ticketPriceUnits;
    const accountedFor = vaults + spentOnTickets;
    check(
      accountedFor <= staked + floatNow,
      'staked value is fully accounted for across vaults, tickets and the house float',
    );
    check(held >= 0n, 'no player balance went negative');
  }

  // ── Isolation ────────────────────────────────────────────────────────────
  group('Player isolation');
  {
    const beforeA = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    const beforeB = (await api('GET', `/api/player?address=${OTHER}`)).json;

    await playRace(OTHER, 'Rival');

    const a = (await api('GET', `/api/player?address=${PLAYER}`)).json;
    const b = (await api('GET', `/api/player?address=${OTHER}`)).json;

    check(
      b.player.racesPlayed === beforeB.player.racesPlayed + 1 &&
        a.player.racesPlayed === beforeA.player.racesPlayed,
      "racing as one player advances only that player's counters",
    );
    check(
      BigInt(a.balance.creditsUnits) === BigInt(beforeA.balance.creditsUnits),
      "and only that player's balance is spent",
    );
    check(
      a.player.lifetimePoints !== b.player.lifetimePoints,
      "one player's points do not leak into another's",
    );
  }

  // ── Withdrawal guard ─────────────────────────────────────────────────────
  group('Withdrawals');
  {
    const profile = (await api('GET', `/api/player?address=${OTHER}`)).json;
    const balance = BigInt(profile.balance.creditsUnits);

    const over = await api('POST', '/api/withdraw', {
      address: OTHER, amountUnits: (balance + 1_000_000n).toString(),
    });
    check(over.status === 400 && over.json.code === 'INSUFFICIENT_FUNDS', 'you cannot withdraw more than you hold');

    const after = (await api('GET', `/api/player?address=${OTHER}`)).json;
    check(
      BigInt(after.balance.creditsUnits) === balance,
      'and a refused withdrawal does not touch the balance',
    );
  }

  // ── Out of balance ───────────────────────────────────────────────────────
  group('Running out of balance');
  {
    let guard = 0;
    let status = 200;
    while (status === 200 && guard++ < 60) {
      status = (await api('POST', '/api/lobby/join', { address: THIRD, name: 'Tail' })).status;
    }
    check(status === 402, 'once the balance is spent, joining returns 402 Payment Required');

    const profile = (await api('GET', `/api/player?address=${THIRD}`)).json;
    check(profile.balance.entriesAffordable === 0, 'and the profile reports zero entries affordable');
    check(BigInt(profile.balance.creditsUnits) < entryFeeUnits, 'with a balance below one entry fee');
  }

  // ── The high score feed ──────────────────────────────────────────────────
  group('High score feed');
  {
    const { status, json } = await api('GET', '/api/recent');
    check(status === 200 && json?.ok, 'GET /api/recent responds');

    if (json?.ok) {
      check(Array.isArray(json.winners), 'it returns a winners array');
      check(json.winners.length > 0, `${json.winners.length} settled races on the board`);
      check(
        json.winners.every((w: Json) => typeof w.name === 'string' && w.name.length > 0),
        'every row names a winner',
      );
      check(
        json.winners.every((w: Json) => typeof w.isHouse === 'boolean'),
        'and says whether it was the house — a board of only human wins would misstate the odds',
      );
      check(
        json.winners.some((w: Json) => w.isHouse) || json.totals.humanWins === json.winners.length,
        'house victories are included rather than filtered out',
      );
      check(
        json.winners.every((w: Json) => w.points > 0),
        'a winner always scored above zero (a refunded race has no winner)',
      );
      check(
        json.winners.every((w: Json) => w.wonFromBehind === w.placement > 1),
        'the from-behind flag agrees with the finish position it reports',
      );
      check(json.totals.ticketsMinted >= 1, `${json.totals.ticketsMinted} tickets across the board`);
      check(BigInt(json.totals.potUnits) > 0n, 'and the staked total is accounted for');
      check(
        json.winners.every((w: Json) => !('id' in w) && !('address' in w)),
        'no wallet address is exposed on a public board',
      );
    }
  }

  // ── Winning tickets and claiming ─────────────────────────────────────────
  group('Winning tickets');
  {
    check(
      (await api('GET', '/api/wins?address=nope')).status === 400,
      'the wins route rejects a bad address',
    );

    const { status, json } = await api('GET', `/api/wins?address=${PLAYER}`);
    check(status === 200 && json?.ok, 'GET /api/wins responds for a real wallet');

    if (json?.ok) {
      check(Array.isArray(json.wins), 'it returns a wins array');
      check(
        Array.isArray(json.claimableTicketIds),
        'and the exact uint256[] that claimWinnings takes',
      );
      check(
        json.claimableTicketIds.length === json.wins.filter((r: Json) => !r.claimed).length,
        'claimable ids are precisely the unclaimed wins — never one already redeemed',
      );
      check(
        /^0x[a-fA-F0-9]{40}$/.test(json.jackpotAddress),
        'it hands back the Jackpot address the claim must be sent to',
      );
      check(
        typeof json.unclaimedUnits === 'string' && /^\d+$/.test(json.unclaimedUnits),
        'amounts are integer base units, never floats',
      );
      // The testnet Data API is not always reachable. Degrading to "no wins"
      // is correct; throwing a 500 at a player checking their winnings is not.
      check(
        json.apiError === null || json.wins.length === 0,
        json.apiError
          ? `an unreachable Data API degrades to an empty board (${json.apiError})`
          : 'the Data API was reachable',
      );
    }
  }

  // ── Referral revenue ─────────────────────────────────────────────────────
  group('Referral revenue');
  {
    const { status, json } = await api('GET', '/api/admin/referral');
    check(status === 200 && json?.ok, 'GET /api/admin/referral reports without auth (read-only)');

    if (json?.ok && json.configured) {
      check(/^0x[a-fA-F0-9]{40}$/.test(json.account), `fees accrue to ${json.account}`);
      check(/^\d+$/.test(json.owedUnits), `${json.owedUnits} base units accrued so far`);
      check(
        json.referralFeePct > 0 && json.referralWinSharePct > 0,
        `live rates read from chain: ${json.referralFeePct}% of ticket, ${json.referralWinSharePct}% of winnings`,
      );
      check(
        json.claimable === (BigInt(json.owedUnits) > 0n),
        'the claimable flag agrees with the accrued balance',
      );
    } else if (json?.ok) {
      check(json.configured === false, 'or says plainly that no referrer is configured');
    }

    // The sweep moves money, so it is gated. Deliberately never POSTed with the
    // correct secret here: that would broadcast a real transaction from a
    // shared testnet key.
    const noAuth = await api('POST', '/api/admin/referral', {});
    check(
      noAuth.status === 401 || noAuth.status === 404,
      `sweeping without the secret is refused (${noAuth.status})`,
    );

    const badAuth = await fetch(`${BASE}/api/admin/referral`, {
      method: 'POST',
      headers: { 'x-admin-secret': 'not-the-secret' },
    });
    check(
      badAuth.status === 401 || badAuth.status === 404,
      'and a wrong secret is refused too',
    );
  }

  // ── Pages render ─────────────────────────────────────────────────────────
  group('Pages');
  {
    for (const [route, markers] of [
      // Everything a visitor needs before any JavaScript runs has to be in the
      // server-rendered HTML.
      // The arcade title screen: brand, the one control, and the live marquee.
      ['/', ['MEGA ARCADE', 'Select a game', 'marquee-track']],
      // The floor: the live cabinet and at least one locked one.
      ['/games', ['Pick a cabinet', 'Rally Vault', 'Coming soon']],
      ['/play', ['Mega Arcade']],
      ['/vault', ['Mega Arcade']],
    ] as const) {
      const res = await fetch(`${BASE}${route}`);
      const html = await res.text();
      const missing = markers.filter((m) => !html.includes(m));
      check(
        res.ok && missing.length === 0,
        missing.length
          ? `${route} renders but is missing ${missing.join(', ')}`
          : `${route} renders (200, contains ${markers.map((m) => `"${m}"`).join(', ')})`,
      );
    }

    // Scrolling is a layout property, but the two rules that broke it are
    // assertable from the stylesheet — and they broke every page at once.
    const html = await (await fetch(`${BASE}/`)).text();
    const cssHref = html.match(/\/_next\/static\/css\/[^"]+\.css/)?.[0];
    check(!!cssHref, 'the stylesheet is linked');

    if (cssHref) {
      const css = await (await fetch(`${BASE}${cssHref}`)).text();
      check(
        !/html,\s*body\s*\{[^}]*overflow-x:\s*hidden/.test(css),
        'the root element has no overflow rule — that is what nested the scroll containers',
      );
      check(
        !/body\s*\{[^}]*overscroll-behavior-y:\s*none/.test(css),
        'and body does not suppress overscroll document-wide',
      );
      // Whitespace-tolerant: the production build minifies this to
      // `overflow-x:clip`, so an exact-string match passes in dev and fails here.
      check(
        /overflow-x:\s*clip/.test(css),
        'body clips horizontally without becoming a scroller',
      );
    }

    const viewport = html.match(/<meta name="viewport" content="([^"]*)"/)?.[1] ?? '';
    check(
      viewport.includes('width=device-width'),
      `the viewport keeps width=device-width ("${viewport}")`,
    );
    check(
      !viewport.includes('user-scalable=no'),
      'and does not disable pinch zoom for the whole app',
    );
  }
}

main()
  .catch((err) => { bad(`fatal: ${(err as Error).message}`); })
  .finally(async () => {
    server?.kill('SIGTERM');
    await sleep(400);
    server?.kill('SIGKILL');
    await rm(DATA_DIR, { recursive: true, force: true });

    console.log(
      fail === 0
        ? `\n\x1b[32m\x1b[1m✓ ${pass} end-to-end checks passed.\x1b[0m\n`
        : `\n\x1b[31m\x1b[1m✗ ${fail} failed, ${pass} passed.\x1b[0m\n`,
    );
    process.exit(fail === 0 ? 0 : 1);
  });
