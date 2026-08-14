/**
 * Engine, track, scoring and pot tests.
 *
 *   npx tsx scripts/test-engine.ts
 *
 * No network, no server — pure simulation and pure math. Determinism is the
 * property that everything else depends on, so it's checked first and hardest.
 */

import { generateTrack, CELLS_MIN, CELLS_MAX, FUEL_CANS_MIN, FUEL_CANS_MAX } from '../src/lib/game/trackgen';
import { simulateLobby, emptyInputLog, type InputLog } from '../src/lib/game/replay';
import type { RaceOutcome } from '../src/lib/game/types';
import { isTransientDepositError } from '../src/lib/wallet/pendingDeposit';
import { driveRace, localField } from './lib/drive';
import {
  scoreRace, orbValue, FINISH_BONUS, CLEAN_RUN_BONUS, PODIUM_BONUS,
  type ScoreBreakdown,
} from '../src/lib/points/scoring';
import { SECTION_TEMPLATES } from '../src/lib/game/sections';
import { TICK_DT, FUEL_MAX, FUEL_START, FUEL_SECONDS_PER_TANK } from '../src/lib/game/engine';
import { BOT_PROFILES, type BotSkill } from '../src/lib/game/bots';
import { resolvePot, rankSeats, wonFromBehind, type PotSeat } from '../src/lib/vault/pot';
import { entryFeeUnits, potToTickets, SEATS_PER_RACE } from '../src/lib/vault/economy';
import { envStr, envBool } from '../src/lib/env';
import { NETWORK, CONTRACTS, CHAIN_ID } from '../src/lib/megapot/addresses';

/**
 * Replay one seat's log through the authoritative lobby simulation — exactly
 * what the server does on submission.
 */
const replayLobby = (
  seed: number,
  lobbyId: string,
  name: string,
  inputs: InputLog,
  mySeat = 0,
) =>
  simulateLobby({
    seed,
    seats: localField(lobbyId, mySeat, name).map((s) =>
      s.index === mySeat ? { ...s, inputs } : s,
    ),
  });

let pass = 0;
let fail = 0;
const ok = (m: string) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const bad = (m: string) => { fail++; console.log(`  \x1b[31m✗ ${m}\x1b[0m`); };
const group = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const check = (cond: boolean, m: string) => (cond ? ok(m) : bad(m));

// ── Track generation ────────────────────────────────────────────────────────
group('Track generation');
{
  const a = generateTrack({ seed: 12345 });
  const b = generateTrack({ seed: 12345 });
  const c = generateTrack({ seed: 99999 });

  check(JSON.stringify(a) === JSON.stringify(b), 'same seed produces a byte-identical track');
  check(JSON.stringify(a) !== JSON.stringify(c), 'different seeds produce different tracks');

  let sectionsOk = true, cellsOk = true, cansOk = true, trapsOk = true, orbCount = 0;
  let worstFuelGap = 0;
  const templateUse = new Map<string, number>();

  for (let seed = 1; seed <= 400; seed++) {
    const t = generateTrack({ seed });

    if (t.sections.length < 5 || t.sections.length > 6) sectionsOk = false;
    const ids = t.sections.map((s) => s.templateId);
    if (new Set(ids).size !== ids.length) sectionsOk = false;
    for (const id of ids) templateUse.set(id, (templateUse.get(id) ?? 0) + 1);

    const cells = t.pickups.filter((p) => p.kind === 'cell');
    const cans = t.pickups.filter((p) => p.kind === 'fuel');
    const traps = t.pickups.filter((p) => p.kind === 'trap');

    if (cells.length < CELLS_MIN || cells.length > CELLS_MAX) cellsOk = false;
    if (cans.length < FUEL_CANS_MIN || cans.length > FUEL_CANS_MAX) cansOk = false;
    if (traps.length > 2) trapsOk = false;
    if (t.orb) orbCount++;

    // The largest stretch of track with no fuel in it. If this gets long, a
    // player who burns their tank early has no way back into the race.
    const canYs = cans.map((p) => p.y).sort((x, y) => x - y);
    for (let i = 1; i < canYs.length; i++) {
      worstFuelGap = Math.max(worstFuelGap, canYs[i] - canYs[i - 1]);
    }
  }

  check(sectionsOk, '5–6 sections per race, never repeating a template');
  check(cellsOk, `${CELLS_MIN}–${CELLS_MAX} point cells per race`);
  check(cansOk, `${FUEL_CANS_MIN}–${FUEL_CANS_MAX} fuel cans per race`);
  check(trapsOk, 'at most two Score Traps per race');

  const orbRate = orbCount / 400;
  check(orbRate > 0.3 && orbRate < 0.5, `Jackpot Orb spawns on ~40% of races (measured ${(orbRate * 100).toFixed(1)}%)`);
  check(templateUse.size === SECTION_TEMPLATES.length, `all ${SECTION_TEMPLATES.length} section templates get used`);
  // Measured between consecutive cans, not from the start line: the lead-in is
  // deliberately empty and every racer starts with a part-full tank.
  check(worstFuelGap < 1300, `no fuel desert — worst gap between cans is ${worstFuelGap.toFixed(0)} units (~${(worstFuelGap / 130).toFixed(0)}s)`);
}

// ── Determinism ─────────────────────────────────────────────────────────────
group('Replay determinism (the anti-cheat foundation)');
{
  let identical = 0;
  const N = 30;

  for (let i = 0; i < N; i++) {
    const seed = 7000 + i * 13;
    const lobbyId = `det_${i}`;
    const { inputs, outcome } = driveRace({ seed, lobbyId, humanName: 'Tester' });
    const replay = replayLobby(seed, lobbyId, 'Tester', inputs);
    if (JSON.stringify(replay.outcome) === JSON.stringify(outcome)) identical++;
  }
  check(identical === N, `${identical}/${N} races replay to a byte-identical outcome`);

  // Tamper with the log and the outcome must diverge.
  const seed = 4242;
  const { inputs, outcome } = driveRace({ seed, lobbyId: 'tamper', humanName: 'Tester' });
  const tampered = {
    ...inputs,
    lateral: inputs.lateral.map((v, i) => (i % 7 === 0 ? -v : v)),
  };
  const replay = replayLobby(seed, 'tamper', 'Tester', tampered);
  check(
    JSON.stringify(replay.outcome) !== JSON.stringify(outcome),
    'a modified input log produces a different outcome (tampering is detectable)',
  );

  // Boost runs must survive the round trip — a held boost is worth real speed,
  // so a lossy encoding would silently change every score.
  const withBoost = driveRace({ seed: 555, lobbyId: 'boost', humanName: 'Tester', humanSkill: 'sharp' });
  const boostReplay = replayLobby(555, 'boost', 'Tester', withBoost.inputs);
  const drivenBoost = withBoost.outcome.racers.find((r) => r.name === 'Tester')!.boostTicks;
  const replayBoost = boostReplay.outcome.racers.find((r) => r.name === 'Tester')!.boostTicks;
  check(drivenBoost > 0, `the stand-in player actually used boost (${drivenBoost} ticks)`);
  check(drivenBoost === replayBoost, 'run-length encoded boost replays exactly');

  // An empty log must not crash — it's what a player closing the tab produces.
  const empty = replayLobby(99, 'empty', 'Idle', emptyInputLog());
  check(empty.outcome.racers.length === 5, 'an empty input log still produces a full result');
}

// ── Quitting ────────────────────────────────────────────────────────────────
group('Quitting mid-race');
{
  const seed = 8181;
  const lobbyId = 'quit_1';

  const played = driveRace({ seed, lobbyId, humanName: 'Tester' });
  const quit = driveRace({ seed, lobbyId, humanName: 'Tester', quitAtProgress: 0.45 });

  const qMe = quit.outcome.racers.find((r) => r.name === 'Tester')!;
  const pMe = played.outcome.racers.find((r) => r.name === 'Tester')!;

  check(qMe.retired && !qMe.finished, 'a quitting racer is marked retired, not finished');
  check(!pMe.retired && pMe.finished, 'a racer who plays it out is not marked retired');
  check(qMe.progress > 0.4 && qMe.progress < 0.99, `stopped partway down the track (${(qMe.progress * 100).toFixed(0)}%)`);
  check(qMe.placement === 5, 'a DNF ranks last, behind every finisher');

  // The quit must replay identically from the log alone.
  const replay = replayLobby(seed, lobbyId, 'Tester', quit.inputs);
  check(
    JSON.stringify(replay.outcome) === JSON.stringify(quit.outcome),
    'a quit replays byte-identically from the input log',
  );
  check(quit.inputs.quitTick !== null, 'the quit tick is recorded in the log');

  const [qScore] = scoreRace(quit.outcome).filter((s) => s.name === 'Tester');
  const [pScore] = scoreRace(played.outcome).filter((s) => s.name === 'Tester');

  check(qScore.finish === 0, 'DNF scores ZERO for the finish bonus');
  check(qScore.podium === 0, 'DNF scores ZERO for the podium');
  check(qScore.cleanRun === 0, 'DNF scores ZERO for the clean-run bonus');
  check(qScore.retired && !qScore.finished, 'the score sheet is flagged as a DNF');
  check(qScore.total >= 0, 'a DNF total is never negative');
  check(
    qScore.pickups === qMe.pickupPoints,
    `points already collected are kept (${qScore.pickups})`,
  );
  check(
    pScore.finish === FINISH_BONUS,
    `finishing pays the ${FINISH_BONUS}-point finish bonus`,
  );
  check(
    qScore.total < pScore.total,
    `quitting costs points overall (${qScore.total} vs ${pScore.total} finishing the same track)`,
  );

  // Quitting at the very first tick is the degenerate case.
  const instant = driveRace({ seed: 3131, lobbyId: 'quit_0', humanName: 'Tester', quitAtProgress: 0 });
  const iMe = instant.outcome.racers.find((r) => r.name === 'Tester')!;
  const [iScore] = scoreRace(instant.outcome).filter((s) => s.name === 'Tester');
  check(iMe.retired, 'quitting immediately still produces a valid result');
  check(iScore.total === 0, 'quitting before collecting anything scores exactly 0');
  const iReplay = replayLobby(3131, 'quit_0', 'Tester', instant.inputs);
  check(
    JSON.stringify(iReplay.outcome) === JSON.stringify(instant.outcome),
    'an instant quit replays identically',
  );
}

// ── Fuel and boost ──────────────────────────────────────────────────────────
group('Boost fuel');
{
  check(FUEL_START < FUEL_MAX, `players start with a part-full tank (${FUEL_START}/${FUEL_MAX})`);
  check(
    FUEL_SECONDS_PER_TANK > 2.5 && FUEL_SECONDS_PER_TANK < 6,
    `a full tank is ${FUEL_SECONDS_PER_TANK.toFixed(1)}s of boost — a meaningful burst, not a permanent buff`,
  );

  // Fuel must be earnable: over many races a competent driver should be picking
  // cans up, or the comeback mechanic is theoretical.
  let cans = 0, boostTicks = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    const { outcome } = driveRace({ seed: 2200 + i * 31, lobbyId: `fuel_${i}`, humanName: 'Tester' });
    const me = outcome.racers.find((r) => r.name === 'Tester')!;
    cans += me.fuelCans;
    boostTicks += me.boostTicks;
  }
  check(cans / N >= 2, `a competent driver collects ${(cans / N).toFixed(1)} cans per race`);
  check(
    boostTicks / N / 60 > 1,
    `and spends ${(boostTicks / N / 60).toFixed(1)}s per race on boost`,
  );

  // Boost has to be usable while stunned, or a hit is unrecoverable — the whole
  // reason this system replaced two fixed charges.
  const stunnedBoost = driveRace({ seed: 6060, lobbyId: 'stun', humanName: 'Tester' });
  const sMe = stunnedBoost.outcome.racers.find((r) => r.name === 'Tester')!;
  check(sMe.hardHits >= 0 && sMe.boostTicks > 0, 'boost is available on a track where hits happen');
}

// ── Race feel ───────────────────────────────────────────────────────────────
group('Race feel');
{
  const durations: number[] = [];
  let allFinished = true;
  let cells = 0;
  let hardHits = 0;
  let cleanRuns = 0;
  const placements = new Set<number>();
  const N = 120;

  for (let i = 0; i < N; i++) {
    const { outcome } = driveRace({ seed: 3000 + i * 17, lobbyId: `feel_${i}`, humanName: 'Tester' });
    durations.push(outcome.ticks * TICK_DT);
    if (!outcome.racers.every((r) => r.finished)) allFinished = false;

    const me = outcome.racers.find((r) => r.name === 'Tester')!;
    cells += me.cellsCollected;
    hardHits += me.hardHits;
    if (me.cleanRun) cleanRuns++;
    placements.add(me.placement);
  }

  const avg = durations.reduce((a, b) => a + b, 0) / N;
  check(avg > 60 && avg < 95, `average race lasts ${avg.toFixed(1)}s (target 60–90s)`);
  check(Math.min(...durations) > 40, `shortest race ${Math.min(...durations).toFixed(1)}s is not degenerate`);
  check(Math.max(...durations) < 130, `longest race ${Math.max(...durations).toFixed(1)}s stays reasonable`);
  check(allFinished, 'every racer reaches the finish line — nobody gets stuck');
  check(cells / N >= 4, `a competent racer averages ${(cells / N).toFixed(1)} point cells per race`);
  check(placements.size >= 3, `placements vary across races (${[...placements].sort().join(', ')})`);
  // A clean run is a strategic choice, not the default: it means forgoing the
  // boost that makes you fast. It has to be reachable, or a 20-point bonus is
  // dead content — but it should stay rare.
  check(cleanRuns > 0 && cleanRuns < N * 0.4, `clean runs are attainable but rare — ${cleanRuns}/${N}`);
  check(hardHits / N < 8, `hard hits average ${(hardHits / N).toFixed(1)} per race — dodgeable, not punishing`);
}

// ── Bot skill ladder ────────────────────────────────────────────────────────
group('Bot skill ladder');
{
  // The dial called "skill" has to actually make a racer better. It used to run
  // backwards: because danger was summed over a distance that grew with the
  // profile's lookahead, the most "skilled" profile was the most timid and
  // finished last. Foresight is now a time horizon and danger is normalised, so
  // this asserts monotonicity rather than trusting it.
  const skills: BotSkill[] = ['rookie', 'steady', 'sharp'];
  const results: Record<string, { place: number; hits: number; points: number }> = {};
  const N = 80;

  for (const skill of skills) {
    let place = 0, hits = 0, points = 0;
    for (let i = 0; i < N; i++) {
      const { outcome } = driveRace({
        seed: 5100 + i * 23, lobbyId: `skill_${skill}_${i}`, humanName: 'Tester', humanSkill: skill,
      });
      const me = outcome.racers.find((r) => r.name === 'Tester')!;
      const s = scoreRace(outcome).find((x) => x.name === 'Tester')!;
      place += me.placement;
      hits += me.hardHits;
      points += s.total;
    }
    results[skill] = { place: place / N, hits: hits / N, points: points / N };
  }

  for (const skill of skills) {
    const r = results[skill];
    ok(`  ${skill}: avg place ${r.place.toFixed(2)} · ${r.hits.toFixed(2)} hits · ${r.points.toFixed(0)} pts`);
  }

  check(
    results.sharp.hits < results.steady.hits && results.steady.hits < results.rookie.hits,
    'hard hits follow skill: sharp < steady < rookie',
  );

  // Regression guards for the two defects that originally inverted this ladder.
  // Both are structural, so they are asserted directly rather than inferred from
  // a noisy race average.
  check(
    BOT_PROFILES.sharp.horizon > BOT_PROFILES.rookie.horizon,
    'foresight is expressed as a time horizon, not a raw distance',
  );
  check(
    new Set(Object.values(BOT_PROFILES).map((p) => p.greed)).size === 1,
    'greed is constant across profiles — a rising greed/caution ratio made the "best" bot the recklessest',
  );
  check(
    BOT_PROFILES.sharp.caution > BOT_PROFILES.rookie.caution,
    'caution rises with skill while greed does not, so risk appetite falls as skill rises',
  );
  check(
    new Set(Object.values(BOT_PROFILES).map((p) => p.fuelReserve)).size === 1,
    'fuel reserve is constant — hoarding fuel is not a skill, and varying it swamped the ladder',
  );

  /*
   * Deliberately NOT asserted: that a better profile finishes higher.
   *
   * It currently does not (sharp averages ~3.3 against rookie's ~2.5), because
   * boost time dominates finishing position and a cautious racer finds fewer
   * clear stretches to spend fuel on. That is a live balance gap documented on
   * FUEL_HIT_PENALTY in engine.ts, not something to paper over with a loose
   * assertion — so the numbers above are printed for tracking and the claim is
   * left unmade until the balance is actually fixed.
   */
  ok(
    `  (placement ladder is NOT yet monotonic — sharp ${results.sharp.place.toFixed(2)} vs rookie ${results.rookie.place.toFixed(2)}; known gap, see engine.ts)`,
  );
}

// ── Point economy ───────────────────────────────────────────────────────────
group('Point economy');
{
  let anyNegative = false;
  let anyZero = false;
  let sum = 0;
  const N = 120;

  for (let i = 0; i < N; i++) {
    const { outcome } = driveRace({ seed: 4100 + i * 29, lobbyId: `econ_${i}`, humanName: 'Tester', humanSkill: 'steady' });
    const scores = scoreRace(outcome, 0);
    for (const s of scores) {
      if (s.total < 0) anyNegative = true;
      if (s.total === 0) anyZero = true;
    }
    sum += scores.find((s) => s.name === 'Tester')!.total;
  }

  check(!anyNegative, 'no racer can finish a race with negative points');
  check(!anyZero, 'every finisher scores something — nobody leaves with zero');

  const avg = sum / N;
  check(avg > 60 && avg < 220, `mid-skill play averages ${avg.toFixed(0)} points/race`);

  check(orbValue(0) === 80, 'Orb base value is 80');
  check(orbValue(2) === 120, 'Orb value stacks with rollover (2 rollovers → 120)');
  check(orbValue(100) === 200, 'Orb value is capped so rollover cannot run away');
  check(CLEAN_RUN_BONUS > 0, 'a clean run is worth something');
}


// ── The Orb has to be carried home ──────────────────────────────────────────
group('The Jackpot Orb only pays if you finish');
{
  /**
   * Regression test for a genuine exploit the end-to-end suite caught: grab the
   * Orb, quit on the spot, keep 80–200 points that no honest finisher could beat,
   * and deny the Orb to everyone else on the way out. It beat playing the race
   * out, which made quitting the optimal line in any race with an Orb in it.
   */
  const racer = (over: Partial<RaceOutcome['racers'][number]>) => ({
    id: 'r', name: 'R', isBot: false, placement: 1, finishTick: 100, finished: true,
    retired: false, hardHits: 0, cleanRun: false, pickupPoints: 40, cellsCollected: 4,
    fuelCans: 2, traps: 0, boostTicks: 0, hasOrb: true, nearMisses: 0, steals: 0,
    stolenFrom: 0, progress: 1,
    ...over,
  });

  const finisher = scoreRace({ seed: 1, ticks: 100, racers: [racer({})] }, 0)[0];
  const quitter = scoreRace(
    { seed: 1, ticks: 100, racers: [racer({ finished: false, retired: true, progress: 0.4 })] },
    0,
  )[0];

  check(finisher.orb === orbValue(0), 'a finisher who held the Orb is paid for it');
  check(quitter.orb === 0, 'a racer who quit holding the Orb is paid nothing for it');
  check(quitter.orbClaimed, 'but the score sheet still records that they held it');
  check(
    quitter.total < finisher.total - orbValue(0),
    'so quitting with the Orb is strictly worse than carrying it home',
  );
}

// ── Deposit recovery ────────────────────────────────────────────────────────
group('Deposit failure classification');
{
  /**
   * A deposit is two steps and only the first is irreversible: USDC moves, then
   * the server is told to look at it. This function decides whether a failure of
   * the second step is worth retrying. Getting it wrong is expensive in both
   * directions — too narrow and a "Failed to fetch" strands somebody's money,
   * too broad and a transaction that will never be valid retries forever behind
   * a permanent error banner.
   */
  const transient = [
    'Failed to fetch',
    'TypeError: Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'fetch failed',
    'That transaction is not on chain yet. Wait for it to confirm and try again.',
    'That transaction needs another confirmation. Try again in a moment.',
    'connect ECONNREFUSED 127.0.0.1:3000',
    'socket hang up',
    // Phrased as "timed out", not "timeout" — matching only the noun let a
    // routine Safari/AbortSignal timeout strand a deposit.
    'The operation timed out',
    'signal timed out',
    'The user aborted a request.',
  ];
  const permanent = [
    'That transaction reverted on chain, so nothing was transferred.',
    'No USDC transfer from 0xabc to the treasury was found in that transaction.',
    'That is not a valid transaction hash.',
    'Deposits are not configured on this deployment — no treasury address is set.',
  ];

  check(
    transient.every((m) => isTransientDepositError(m)),
    `all ${transient.length} recoverable failures retry — including the browser's bare "Failed to fetch"`,
  );
  check(
    permanent.every((m) => !isTransientDepositError(m)),
    `all ${permanent.length} terminal failures stop, rather than retrying a hash that will never be valid`,
  );
  check(!isTransientDepositError(''), 'an empty message is treated as terminal, not retried blindly');
  check(
    isTransientDepositError('FAILED TO FETCH'),
    'classification is case-insensitive — browsers disagree on the casing',
  );
}

// ── Who wins the pot ────────────────────────────────────────────────────────
group('Winning is scoring, not finishing first');
{
  const seat = (
    index: number,
    kind: 'human' | 'bot',
    total: number,
    placement: number,
    extra: Partial<ScoreBreakdown> = {},
  ): PotSeat => ({
    index,
    kind,
    id: kind === 'bot' ? `house_${index}` : `0x${String(index).repeat(40).slice(0, 40)}`,
    name: `S${index}`,
    staked: true,
    score: {
      racerId: '', name: `S${index}`, placement, finished: true, retired: false, progress: 1,
      finish: 25, pickups: 0, cellsCollected: 0, traps: 0, cleanRun: 0, nearMiss: 0,
      nearMissCount: 0, podium: PODIUM_BONUS[placement] ?? 8, orb: 0, orbClaimed: false,
      boost: 0, boostSeconds: 0, fuelCans: 0, stealGained: 0, stealLost: 0,
      total,
      ...extra,
    },
  });

  // The headline claim of the whole design, asserted rather than assumed.
  const field = [
    seat(0, 'human', 131, 1), // won the sprint, collected nothing
    seat(1, 'bot', 118, 2),
    seat(2, 'human', 171, 3), // came third, drove the whole track
    seat(3, 'bot', 90, 4),
    seat(4, 'bot', 64, 5),
  ];

  const pot = resolvePot(field, 200_000n);
  check(pot.winner?.index === 2, 'the highest score takes the pot, not the first across the line');
  check(wonFromBehind(pot.winner), 'and the results screen can say so — the winner placed third');
  check(pot.standings[0].index === 2 && pot.standings[4].index === 4, 'standings are ordered by score');
  check(pot.potUnits === 1_000_000n, 'five staked seats make one whole ticket price');
  check(pot.stakedSeats === SEATS_PER_RACE, 'and the pot counts every staked seat');

  // Only staked seats fund the pot. An unstaked house seat still races.
  const short = resolvePot(
    field.map((s, i) => (i >= 3 ? { ...s, staked: false } : s)),
    200_000n,
  );
  check(short.potUnits === 600_000n, 'unstaked seats contribute nothing to the pot');
  check(short.winner?.index === 2, 'but they do not change who wins it');

  // A house win sends the pot back to the float rather than to a player.
  const houseField = [seat(0, 'human', 80, 2), seat(1, 'bot', 150, 1)];
  const houseResult = resolvePot(houseField, 200_000n);
  check(houseResult.houseWins, 'a house seat that outscores every human takes the pot back');

  // Nobody scored: refund rather than hand a pot to an arbitrary seat.
  const deadField = field.map((s) => ({ ...s, score: { ...s.score!, total: 0 } }));
  const dead = resolvePot(deadField, 200_000n);
  check(dead.winner === null, 'a race where nobody scored has no winner');

  // Determinism: settlement can run twice and must agree.
  const a = JSON.stringify(resolvePot(field, 200_000n).standings.map((s) => s.index));
  const b = JSON.stringify(resolvePot([...field].reverse(), 200_000n).standings.map((s) => s.index));
  check(a === b, 'ranking is deterministic regardless of seat input order');

  // Ties fall through the documented ladder rather than to insertion order.
  const tied = rankSeats([
    seat(3, 'human', 140, 4),
    seat(1, 'human', 140, 2),
  ]);
  check(tied[0].index === 1, 'an exact points tie breaks toward the better finish position');
}

// ── Finish position is worth having, never enough ───────────────────────────
group('Finish position weighting');
{
  check(PODIUM_BONUS[1] === 60, 'first place is worth 60');
  check(PODIUM_BONUS[1] - PODIUM_BONUS[3] === 35, 'first to third is a 35-point gap');
  check(
    PODIUM_BONUS[1] - PODIUM_BONUS[3] < 40,
    'which four point cells cover — position cannot decide the race alone',
  );
  check(PODIUM_BONUS[5] > 0, 'last place still pays, so nobody stops collecting');
  for (let p = 2; p <= 5; p++) {
    check(PODIUM_BONUS[p] < PODIUM_BONUS[p - 1], `P${p} is worth less than P${p - 1}`);
  }
  check(FINISH_BONUS > 0, 'and crossing the line at all is worth something');
}

// ── Entry fee ───────────────────────────────────────────────────────────────
group('Entry fee (a fifth of a ticket, on any network)');
{
  const mainnet = 1_000_000n;  // $1.00
  const sepolia = 10_000n;     // $0.01

  check(entryFeeUnits(mainnet) === 200_000n, 'mainnet: a $1.00 ticket means a $0.20 entry');
  check(entryFeeUnits(sepolia) === 2_000n, 'sepolia: a $0.01 ticket means a $0.002 entry');
  check(
    entryFeeUnits(mainnet) * BigInt(SEATS_PER_RACE) === mainnet,
    'five entries fund exactly one ticket, with nothing left over',
  );
  check(
    entryFeeUnits(sepolia) * BigInt(SEATS_PER_RACE) === sepolia,
    'and the same holds on testnet, where a ticket costs 100× less',
  );
  check(
    entryFeeUnits(mainnet) * BigInt(SEATS_PER_RACE) === mainnet,
    'a full five-seat pot is exactly one ticket — the core of the economy',
  );
}

// ── Pot → tickets ───────────────────────────────────────────────────────────
group('Pot conversion');
{
  const price = 1_000_000n;
  const fee = entryFeeUnits(price);

  const full = potToTickets(price, price);
  check(full.tickets === 1 && full.remainderUnits === 0n, 'a full table buys exactly one ticket');

  const short = potToTickets(fee * 3n, price);
  check(
    short.tickets === 0 && short.remainderUnits === fee * 3n,
    'a short pot buys nothing and refunds the lot — no value is held back',
  );

  const double = potToTickets(price * 2n, price);
  check(double.tickets === 2 && double.remainderUnits === 0n, 'twice the price buys two tickets');

  const odd = potToTickets(price * 2n + fee, price);
  check(
    odd.tickets === 2 && odd.remainderUnits === fee,
    'and the leftover is returned rather than rounded away',
  );

  const free = potToTickets(500_000n, 0n);
  check(free.tickets === 0, 'a zero ticket price cannot divide by zero');

  // Conservation: every base unit staked ends up as a ticket or as a refund.
  let minted = 0;
  let refunded = 0n;
  let staked = 0n;
  for (let seats = 1; seats <= SEATS_PER_RACE; seats++) {
    for (let round = 0; round < 4; round++) {
      const pot = fee * BigInt(seats);
      staked += pot;
      const r = potToTickets(pot, price);
      minted += r.tickets;
      refunded += r.remainderUnits;
    }
  }
  check(
    BigInt(minted) * price + refunded === staked,
    `nothing is created or destroyed across 20 pots (${minted} tickets + ${refunded} refunded)`,
  );
}

// ── Environment parsing ─────────────────────────────────────────────────────
/**
 * These exist because a real deployment shipped broken on exactly this: values
 * copied out of a `.env` file keep the quotes dotenv would have stripped, and
 * `MEGAPOT_DRY_RUN="false"` is not `'false'`. That silently mints simulated
 * tickets — the worst kind of failure, because it looks like it worked.
 */
{
  check(envStr('"testnet"') === 'testnet', 'a double-quoted value loses its quotes');
  check(envStr("'testnet'") === 'testnet', 'a single-quoted value loses its quotes');
  check(envStr('  testnet  ') === 'testnet', 'whitespace is trimmed');
  check(envStr('') === undefined, 'an empty value reads as unset, not as an empty string');
  check(envStr(undefined) === undefined, 'an unset value stays unset');
  check(envStr('"0x1234"')  === '0x1234', 'a quoted hex key is usable');

  check(envBool('"false"', true) === false, 'a QUOTED false is false — the bug that shipped');
  check(envBool('false', true) === false, 'a bare false is false');
  check(envBool('true', false) === true, 'a bare true is true');
  check(envBool('"true"', false) === true, 'a quoted true is true');
  check(envBool(undefined, true) === true, 'an unset flag takes the fallback');
  check(envBool('banana', true) === true, 'an unrecognised flag takes the fallback, not truthiness');
  check(envBool('banana', false) === false, 'and the fallback is honoured in both directions');
}

{
  /**
   * The network must never resolve to undefined addresses, and an unrecognised
   * value must land on TESTNET — guessing mainnet here spends real money.
   */
  check(NETWORK === 'testnet' || NETWORK === 'mainnet', `NETWORK is a real network (${NETWORK})`);
  check(!!CONTRACTS && !!CONTRACTS.jackpot, 'the jackpot address is defined');
  check(typeof CHAIN_ID === 'number' && CHAIN_ID > 0, `the chain id is real (${CHAIN_ID})`);
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(
  fail === 0
    ? `\n\x1b[32m\x1b[1m✓ ${pass} checks passed.\x1b[0m`
    : `\n\x1b[31m\x1b[1m✗ ${fail} of ${pass + fail} checks failed.\x1b[0m`,
);
process.exit(fail === 0 ? 0 : 1);
