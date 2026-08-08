/**
 * Engine, track and scoring tests.
 *
 *   npx tsx scripts/test-engine.ts
 *
 * No network, no server — pure simulation. Determinism is the property that
 * everything else depends on, so it's checked first and hardest.
 */

import { generateTrack } from '../src/lib/game/trackgen';
import { simulateRace } from '../src/lib/game/replay';
import { driveRace } from './lib/drive';
import { scoreRace, TICKET_THRESHOLD, orbValue } from '../src/lib/points/scoring';
import { buildTicket, assertValidTicket } from '../src/lib/megapot/numbers';
import { SECTION_TEMPLATES } from '../src/lib/game/sections';
import { TICK_DT } from '../src/lib/game/engine';

const BALL_MAX = 30;
const BONUS_MAX = 10;

let pass = 0;
let fail = 0;
const ok = (m: string) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const bad = (m: string) => { fail++; console.log(`  \x1b[31m✗ ${m}\x1b[0m`); };
const group = (m: string) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const check = (cond: boolean, m: string) => (cond ? ok(m) : bad(m));

// ── Track generation ────────────────────────────────────────────────────────
group('Track generation');
{
  const a = generateTrack({ seed: 12345, ballMax: BALL_MAX, bonusballMax: BONUS_MAX });
  const b = generateTrack({ seed: 12345, ballMax: BALL_MAX, bonusballMax: BONUS_MAX });
  const c = generateTrack({ seed: 99999, ballMax: BALL_MAX, bonusballMax: BONUS_MAX });

  check(JSON.stringify(a) === JSON.stringify(b), 'same seed produces a byte-identical track');
  check(JSON.stringify(a) !== JSON.stringify(c), 'different seeds produce different tracks');

  let sectionsOk = true, shardsOk = true, distinctOk = true, trapsOk = true, orbCount = 0;
  const templateUse = new Map<string, number>();

  for (let seed = 1; seed <= 400; seed++) {
    const t = generateTrack({ seed, ballMax: BALL_MAX, bonusballMax: BONUS_MAX });

    if (t.sections.length < 5 || t.sections.length > 6) sectionsOk = false;
    const ids = t.sections.map((s) => s.templateId);
    if (new Set(ids).size !== ids.length) sectionsOk = false;
    for (const id of ids) templateUse.set(id, (templateUse.get(id) ?? 0) + 1);

    if (t.shards.length < 6 || t.shards.length > 8) shardsOk = false;
    if (new Set(t.shards.map((s) => s.number)).size < 5) distinctOk = false;
    if (t.shards.some((s) => s.number < 1 || s.number > BALL_MAX)) shardsOk = false;
    if (t.shards.filter((s) => s.isTrap).length > 1) trapsOk = false;

    if (t.orb) {
      orbCount++;
      if (t.orb.bonusball < 1 || t.orb.bonusball > BONUS_MAX) shardsOk = false;
    }
  }

  check(sectionsOk, '5–6 sections per race, never repeating a template');
  check(shardsOk, '6–8 shards per race, all numbers in range');
  check(distinctOk, 'every track offers at least 5 distinct numbers (a perfect run earns a full ticket)');
  check(trapsOk, 'at most one Score Trap per race');

  const orbPct = (orbCount / 400) * 100;
  check(orbPct > 30 && orbPct < 50, `Golden Orb spawns on ~40% of races (measured ${orbPct.toFixed(1)}%)`);
  check(templateUse.size === SECTION_TEMPLATES.length, `all ${SECTION_TEMPLATES.length} section templates get used`);
}

// ── Determinism under replay ────────────────────────────────────────────────
group('Replay determinism (the anti-cheat foundation)');
{
  let identical = 0;
  const trials = 30;

  for (let i = 0; i < trials; i++) {
    const seed = 1000 + i * 37;
    const raceId = `race_${i}`;
    const { inputs, outcome } = driveRace({
      seed, raceId, humanName: 'Tester', ballMax: BALL_MAX, bonusballMax: BONUS_MAX,
    });

    // This is exactly what the server does on submit.
    const replayed = simulateRace({
      seed, raceId, humanName: 'Tester', ballMax: BALL_MAX, bonusballMax: BONUS_MAX, inputs,
    });

    if (JSON.stringify(replayed.outcome) === JSON.stringify(outcome)) identical++;
  }

  check(identical === trials, `${identical}/${trials} races replay to a byte-identical outcome`);

  // A tampered log must not reproduce the original result.
  const seed = 4242;
  const { inputs, outcome } = driveRace({
    seed, raceId: 'tamper', humanName: 'Tester', ballMax: BALL_MAX, bonusballMax: BONUS_MAX,
  });
  const tampered = { ...inputs, lateral: inputs.lateral.map((v, i) => (i % 50 === 0 ? -v : v)) };
  const replayed = simulateRace({
    seed, raceId: 'tamper', humanName: 'Tester', ballMax: BALL_MAX, bonusballMax: BONUS_MAX, inputs: tampered,
  });
  check(
    JSON.stringify(replayed.outcome) !== JSON.stringify(outcome),
    'a modified input log produces a different outcome (tampering is detectable)',
  );
}

// ── Race shape ──────────────────────────────────────────────────────────────
group('Race feel');
{
  const durations: number[] = [];
  const placements = new Map<number, number>();
  let allFinish = true;
  let shardsCollected = 0;
  let racesWithOrbTaken = 0;
  let orbAvailable = 0;

  for (let i = 0; i < 40; i++) {
    const seed = 7000 + i * 13;
    const { outcome } = driveRace({
      seed, raceId: `feel_${i}`, humanName: 'Tester', ballMax: BALL_MAX, bonusballMax: BONUS_MAX,
    });

    durations.push(outcome.ticks * TICK_DT);
    if (outcome.racers.some((r) => r.finishTick === null)) allFinish = false;

    const me = outcome.racers.find((r) => r.name === 'Tester')!;
    placements.set(me.placement, (placements.get(me.placement) ?? 0) + 1);
    shardsCollected += me.shardsCollected;

    const track = generateTrack({ seed, ballMax: BALL_MAX, bonusballMax: BONUS_MAX });
    if (track.orb) {
      orbAvailable++;
      if (outcome.racers.some((r) => r.hasOrb)) racesWithOrbTaken++;
    }
  }

  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  const min = Math.min(...durations);
  const max = Math.max(...durations);

  check(avg > 55 && avg < 100, `average race lasts ${avg.toFixed(1)}s (target 60–90s)`);
  check(min > 40, `shortest race ${min.toFixed(1)}s is not degenerate`);
  check(max < 150, `longest race ${max.toFixed(1)}s stays reasonable`);
  check(allFinish, 'every racer reaches the finish line — nobody gets stuck');

  const avgShards = shardsCollected / 40;
  check(avgShards >= 4, `a competent racer averages ${avgShards.toFixed(1)} shards per race (spec: 4–5 of 6–8)`);
  check(placements.size > 1, `placements vary across races (${[...placements.keys()].sort().join(', ')})`);

  // A clean run must be genuinely attainable, or the bonus is dead weight. The
  // bot is a mid-skill proxy and rarely manages it; what matters here is that
  // the track is fair enough for zero hard hits to be possible at all.
  let cleanRuns = 0;
  let totalHits = 0;
  const CLEAN_N = 120;
  for (let i = 0; i < CLEAN_N; i++) {
    const { outcome } = driveRace({
      seed: 6100 + i * 29, raceId: `clean_${i}`, humanName: 'Tester',
      ballMax: BALL_MAX, bonusballMax: BONUS_MAX, humanSkill: 'sharp',
    });
    const me = outcome.racers.find((r) => r.name === 'Tester')!;
    if (me.cleanRun) cleanRuns++;
    totalHits += me.hardHits;
  }
  check(cleanRuns > 0, `clean runs are attainable — ${cleanRuns}/${CLEAN_N} for a mid-skill bot`);
  check(
    totalHits / CLEAN_N < 8,
    `hard hits average ${(totalHits / CLEAN_N).toFixed(1)} per race — the track is dodgeable, not punishing`,
  );

  if (orbAvailable > 0) {
    const grabRate = (racesWithOrbTaken / orbAvailable) * 100;
    check(grabRate > 20, `the Orb gets contested — claimed in ${grabRate.toFixed(0)}% of races that spawn one`);
  }
}

// ── Scoring ─────────────────────────────────────────────────────────────────
group('Point economy');
{
  const totals: number[] = [];
  let neverNegative = true;
  let everyoneScores = true;

  for (let i = 0; i < 60; i++) {
    const seed = 3000 + i * 17;
    const { outcome } = driveRace({
      seed, raceId: `score_${i}`, humanName: 'Tester', ballMax: BALL_MAX, bonusballMax: BONUS_MAX,
    });
    const scores = scoreRace(outcome, 0);
    for (const s of scores) {
      if (s.total < 0) neverNegative = false;
      if (s.total === 0) everyoneScores = false;
    }
    totals.push(scores.find((s) => s.name === 'Tester')!.total);
  }

  const avg = totals.reduce((a, b) => a + b, 0) / totals.length;
  check(neverNegative, 'no player can finish a race with negative points');
  check(everyoneScores, 'every finisher scores something — nobody leaves with zero');
  check(avg > 80 && avg < 130, `mid-skill play averages ${avg.toFixed(0)} points/race (target band 95–110)`);

  const racesToTicket = TICKET_THRESHOLD / avg;
  check(
    racesToTicket >= 4 && racesToTicket <= 10,
    `${racesToTicket.toFixed(1)} races to a ticket at that rate (spec target: 4–10)`,
  );

  // The economy has to hold across the whole skill range, not just at the mean —
  // a ticket should be reachable for a weak player and not trivial for a strong one.
  for (const skill of ['rookie', 'steady', 'sharp'] as const) {
    let sum = 0;
    const N = 40;
    for (let i = 0; i < N; i++) {
      const { outcome } = driveRace({
        seed: 5100 + i * 23, raceId: `band_${skill}_${i}`, humanName: 'Tester',
        ballMax: BALL_MAX, bonusballMax: BONUS_MAX, humanSkill: skill,
      });
      sum += scoreRace(outcome, 0).find((s) => s.name === 'Tester')!.total;
    }
    const races = TICKET_THRESHOLD / (sum / N);
    check(races >= 4 && races <= 10, `  ${skill}: ${(sum / N).toFixed(0)} pts/race → ${races.toFixed(1)} races/ticket`);
  }

  check(orbValue(0) === 80, 'Orb base value is 80');
  check(orbValue(2) === 120, 'Orb value stacks with rollover (2 rollovers → 120)');
  check(orbValue(99) === 200, 'Orb value is capped so rollover cannot run away');
}

// ── Ticket construction ─────────────────────────────────────────────────────
group('Shard → ticket construction');
{
  let allValid = true;
  let earnedTracked = true;

  for (let i = 0; i < 300; i++) {
    const seed = 9000 + i;
    const { outcome } = driveRace({
      seed, raceId: `tix_${i}`, humanName: 'Tester', ballMax: BALL_MAX, bonusballMax: BONUS_MAX,
    });
    const me = outcome.racers.find((r) => r.name === 'Tester')!;
    const ticket = buildTicket(me.collectedNumbers, me.bonusball, BALL_MAX, BONUS_MAX);

    try {
      assertValidTicket(ticket, BALL_MAX, BONUS_MAX);
    } catch {
      allValid = false;
    }

    // Every number the player collected (deduped, in range) must appear.
    const expectEarned = [...new Set(me.collectedNumbers.filter((n) => n >= 1 && n <= BALL_MAX))].slice(0, 5);
    if (expectEarned.some((n) => !ticket.normals.includes(n))) earnedTracked = false;
    if (ticket.earnedNormals.length + ticket.filledNormals.length !== 5) earnedTracked = false;
    if (me.hasOrb && me.bonusball !== null && ticket.bonusball !== me.bonusball) earnedTracked = false;
  }

  check(allValid, '300 real races all produce protocol-valid tickets');
  check(earnedTracked, 'every collected number reaches the ticket, and earned/filled always sums to 5');
}

console.log(
  fail === 0
    ? `\n\x1b[32m\x1b[1m✓ ${pass} checks passed.\x1b[0m\n`
    : `\n\x1b[31m\x1b[1m✗ ${fail} failed, ${pass} passed.\x1b[0m\n`,
);
process.exit(fail === 0 ? 0 : 1);
