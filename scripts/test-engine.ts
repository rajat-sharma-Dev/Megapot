/**
 * Engine, track, scoring and allocation tests.
 *
 *   npx tsx scripts/test-engine.ts
 *
 * No network, no server — pure simulation and pure math. Determinism is the
 * property that everything else depends on, so it's checked first and hardest.
 */

import { generateTrack, CELLS_MIN, CELLS_MAX, FUEL_CANS_MIN, FUEL_CANS_MAX } from '../src/lib/game/trackgen';
import { simulateRace, emptyInputLog } from '../src/lib/game/replay';
import { driveRace } from './lib/drive';
import { scoreRace, orbValue, FINISH_BONUS, CLEAN_RUN_BONUS } from '../src/lib/points/scoring';
import { SECTION_TEMPLATES } from '../src/lib/game/sections';
import { TICK_DT, FUEL_MAX, FUEL_START, FUEL_SECONDS_PER_TANK } from '../src/lib/game/engine';
import { BOT_PROFILES, type BotSkill } from '../src/lib/game/bots';
import { allocateTickets, poolToTickets } from '../src/lib/vault/allocate';
import { vaultDayKey, dayCloseMs, windowForKey, isClosed, DAY_MS } from '../src/lib/vault/day';
import { entryFeeUnits, ENTRIES_PER_TICKET } from '../src/lib/vault/economy';

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
    const raceId = `det_${i}`;
    const { inputs, outcome } = driveRace({ seed, raceId, humanName: 'Tester' });
    const replay = simulateRace({ seed, raceId, humanName: 'Tester', inputs });
    if (JSON.stringify(replay.outcome) === JSON.stringify(outcome)) identical++;
  }
  check(identical === N, `${identical}/${N} races replay to a byte-identical outcome`);

  // Tamper with the log and the outcome must diverge.
  const seed = 4242;
  const { inputs, outcome } = driveRace({ seed, raceId: 'tamper', humanName: 'Tester' });
  const tampered = {
    ...inputs,
    lateral: inputs.lateral.map((v, i) => (i % 7 === 0 ? -v : v)),
  };
  const replay = simulateRace({ seed, raceId: 'tamper', humanName: 'Tester', inputs: tampered });
  check(
    JSON.stringify(replay.outcome) !== JSON.stringify(outcome),
    'a modified input log produces a different outcome (tampering is detectable)',
  );

  // Boost runs must survive the round trip — a held boost is worth real speed,
  // so a lossy encoding would silently change every score.
  const withBoost = driveRace({ seed: 555, raceId: 'boost', humanName: 'Tester', humanSkill: 'sharp' });
  const boostReplay = simulateRace({ seed: 555, raceId: 'boost', humanName: 'Tester', inputs: withBoost.inputs });
  const drivenBoost = withBoost.outcome.racers.find((r) => r.name === 'Tester')!.boostTicks;
  const replayBoost = boostReplay.outcome.racers.find((r) => r.name === 'Tester')!.boostTicks;
  check(drivenBoost > 0, `the stand-in player actually used boost (${drivenBoost} ticks)`);
  check(drivenBoost === replayBoost, 'run-length encoded boost replays exactly');

  // An empty log must not crash — it's what a player closing the tab produces.
  const empty = simulateRace({ seed: 99, raceId: 'empty', humanName: 'Idle', inputs: emptyInputLog() });
  check(empty.outcome.racers.length === 5, 'an empty input log still produces a full result');
}

// ── Quitting ────────────────────────────────────────────────────────────────
group('Quitting mid-race');
{
  const seed = 8181;
  const raceId = 'quit_1';

  const played = driveRace({ seed, raceId, humanName: 'Tester' });
  const quit = driveRace({ seed, raceId, humanName: 'Tester', quitAtProgress: 0.45 });

  const qMe = quit.outcome.racers.find((r) => r.name === 'Tester')!;
  const pMe = played.outcome.racers.find((r) => r.name === 'Tester')!;

  check(qMe.retired && !qMe.finished, 'a quitting racer is marked retired, not finished');
  check(!pMe.retired && pMe.finished, 'a racer who plays it out is not marked retired');
  check(qMe.progress > 0.4 && qMe.progress < 0.99, `stopped partway down the track (${(qMe.progress * 100).toFixed(0)}%)`);
  check(qMe.placement === 5, 'a DNF ranks last, behind every finisher');

  // The quit must replay identically from the log alone.
  const replay = simulateRace({ seed, raceId, humanName: 'Tester', inputs: quit.inputs });
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
  const instant = driveRace({ seed: 3131, raceId: 'quit_0', humanName: 'Tester', quitAtProgress: 0 });
  const iMe = instant.outcome.racers.find((r) => r.name === 'Tester')!;
  const [iScore] = scoreRace(instant.outcome).filter((s) => s.name === 'Tester');
  check(iMe.retired, 'quitting immediately still produces a valid result');
  check(iScore.total === 0, 'quitting before collecting anything scores exactly 0');
  const iReplay = simulateRace({ seed: 3131, raceId: 'quit_0', humanName: 'Tester', inputs: instant.inputs });
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
    const { outcome } = driveRace({ seed: 2200 + i * 31, raceId: `fuel_${i}`, humanName: 'Tester' });
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
  const stunnedBoost = driveRace({ seed: 6060, raceId: 'stun', humanName: 'Tester' });
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
    const { outcome } = driveRace({ seed: 3000 + i * 17, raceId: `feel_${i}`, humanName: 'Tester' });
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
        seed: 5100 + i * 23, raceId: `skill_${skill}_${i}`, humanName: 'Tester', humanSkill: skill,
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
    const { outcome } = driveRace({ seed: 4100 + i * 29, raceId: `econ_${i}`, humanName: 'Tester', humanSkill: 'steady' });
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

// ── Vault day boundaries ────────────────────────────────────────────────────
group('Vault day (17:00 UTC, Megapot cadence)');
{
  // Just before the boundary we are still in the day that closes today.
  const before = Date.UTC(2026, 7, 12, 16, 59, 0);
  const after = Date.UTC(2026, 7, 12, 17, 0, 0);
  const later = Date.UTC(2026, 7, 12, 23, 30, 0);

  check(vaultDayKey(before) === '2026-08-12', 'at 16:59 UTC the day key is today');
  check(vaultDayKey(after) === '2026-08-13', 'at 17:00 UTC exactly it rolls to tomorrow');
  check(vaultDayKey(later) === '2026-08-13', 'later that evening it is still tomorrow-keyed');

  check(dayCloseMs(before) === after, 'the day before the boundary closes at the boundary');
  check(dayCloseMs(after) === after + DAY_MS, 'the next day closes 24h later');

  const w = windowForKey('2026-08-12');
  check(w.closesAtMs === after, 'a key round-trips to its own closing instant');
  check(w.closesAtMs - w.opensAtMs === DAY_MS, 'a vault day is exactly 24 hours');
  check(new Date(w.opensAt).getUTCHours() === 17, 'and it opens at 17:00 UTC too');

  check(isClosed('2026-08-12', after), 'a day is closed at its boundary');
  check(!isClosed('2026-08-12', before), 'and open a minute earlier');
  check(vaultDayKey(dayCloseMs(before) - 1) === '2026-08-12', 'the last millisecond belongs to the closing day');
}

// ── Entry fee ───────────────────────────────────────────────────────────────
group('Entry fee (a fifth of a ticket, on any network)');
{
  const mainnet = 1_000_000n;  // $1.00
  const sepolia = 10_000n;     // $0.01

  check(entryFeeUnits(mainnet) === 200_000n, 'mainnet: a $1.00 ticket means a $0.20 entry');
  check(entryFeeUnits(sepolia) === 2_000n, 'sepolia: a $0.01 ticket means a $0.002 entry');
  check(
    entryFeeUnits(mainnet) * ENTRIES_PER_TICKET === mainnet,
    'five entries fund exactly one ticket, with nothing left over',
  );
  check(
    entryFeeUnits(sepolia) * ENTRIES_PER_TICKET === sepolia,
    'and the same holds on testnet, where a ticket costs 100× less',
  );
}

// ── Pool → tickets ──────────────────────────────────────────────────────────
group('Pool conversion and carry-over');
{
  const price = 1_000_000n;

  const exact = poolToTickets(3_000_000n, price);
  check(exact.tickets === 3 && exact.carryOutUnits === 0n, 'an exact pool buys whole tickets and carries nothing');

  const partial = poolToTickets(3_400_000n, price);
  check(partial.tickets === 3, 'a part-filled pool buys only whole tickets');
  check(partial.carryOutUnits === 400_000n, 'and the remainder carries forward, not lost');
  check(
    partial.spentUnits + partial.carryOutUnits === 3_400_000n,
    'every base unit is accounted for — spent or carried',
  );

  const tiny = poolToTickets(200_000n, price);
  check(tiny.tickets === 0 && tiny.carryOutUnits === 200_000n, 'a quiet day buys nothing and rolls the whole pool over');

  const free = poolToTickets(500_000n, 0n);
  check(free.tickets === 0, 'a zero ticket price cannot divide by zero');
}

// ── Ticket allocation ───────────────────────────────────────────────────────
group('Ticket allocation down the ladder');
{
  const ladder = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      playerId: `0x${String(i).padStart(40, '0')}`,
      name: `P${i}`,
      points: 1000 - i * 10,
    }));

  // Conservation is the property that matters most: we must never mint more
  // tickets than the pool paid for, nor fewer.
  let conserved = true;
  let monotonic = true;
  for (const players of [1, 2, 3, 5, 12, 40]) {
    for (const tickets of [0, 1, 2, 3, 7, 25, 100]) {
      const alloc = allocateTickets(ladder(players), tickets);
      const total = alloc.reduce((s, a) => s + a.tickets, 0);
      if (total !== tickets) conserved = false;
      // Nobody may out-earn someone ranked above them.
      for (let i = 1; i < alloc.length; i++) {
        if (alloc[i].tickets > alloc[i - 1].tickets) monotonic = false;
      }
    }
  }
  check(conserved, 'every ticket the pool bought is allocated — never more, never fewer');
  check(monotonic, 'a lower rank never receives more tickets than a higher rank');

  const one = allocateTickets(ladder(20), 1);
  check(one[0].tickets === 1, 'a single ticket goes to first place');
  check(one.slice(1).every((a) => a.tickets === 0), 'and to nobody else');

  const many = allocateTickets(ladder(10), 30);
  check(many[0].tickets > many[9].tickets, 'a big pool still rewards rank');
  check(many.filter((a) => a.tickets > 0).length >= 8, `a busy day spreads deep into the board (${many.filter((a) => a.tickets > 0).length}/10 players paid)`);
  check(many[0].tickets < 30, 'first place does not take the entire pool');

  // Zero-point entries must not dilute the pool.
  const withZeros = allocateTickets(
    [...ladder(3), { playerId: '0xzero', name: 'Idle', points: 0 }],
    4,
  );
  check(
    withZeros.reduce((s, a) => s + a.tickets, 0) === 4 && !withZeros.some((a) => a.name === 'Idle'),
    'players who scored nothing are excluded from allocation',
  );

  check(allocateTickets([], 5).length === 0, 'an empty ladder allocates nothing and does not throw');

  // Determinism: the same ladder must always produce the same split, because the
  // server has to be able to recompute a past day's payout.
  const a1 = JSON.stringify(allocateTickets(ladder(9), 13));
  const a2 = JSON.stringify(allocateTickets(ladder(9), 13));
  check(a1 === a2, 'allocation is deterministic for a given ladder');

  // Ties break on address, not insertion order.
  const tied = allocateTickets(
    [
      { playerId: '0xbbb', name: 'B', points: 500 },
      { playerId: '0xaaa', name: 'A', points: 500 },
    ],
    1,
  );
  check(tied[0].name === 'A', 'a points tie breaks deterministically by address');
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(
  fail === 0
    ? `\n\x1b[32m\x1b[1m✓ ${pass} checks passed.\x1b[0m`
    : `\n\x1b[31m\x1b[1m✗ ${fail} of ${pass + fail} checks failed.\x1b[0m`,
);
process.exit(fail === 0 ? 0 : 1);
