/**
 * Point scoring — the authoritative math.
 *
 * This runs on the SERVER against a re-simulated race. The client renders a
 * preview with the same functions, but a client-reported score is never trusted:
 * the highest total in a lobby takes the entire pot, so the only score that
 * counts is one the server derived itself from the seed and the input log.
 */

import type { RaceOutcome, RaceResultRacer } from '../game/types';

export const FINISH_BONUS = 25;
export const CLEAN_RUN_BONUS = 20;
export const NEAR_MISS_POINTS = 1;
export const NEAR_MISS_CAP = 10;
export const STEAL_VALUE = 15;
export const MAX_STEALS = 2;

/**
 * Finish position bonus — deliberately large enough to fight over and
 * deliberately too small to decide the race on its own.
 *
 * A mid-skill run scores around 140 points in total, so first place is worth
 * roughly a third of a run: a real prize, and a real reason to sprint for the
 * line. But the gap between first and third is only 35 points, which one good
 * section of point cells covers. That is the intended shape of the game — the
 * racer who wins the sprint and collects nothing loses to the racer who came
 * third and drove the whole track.
 *
 * The tail is flat on purpose. 4th and 5th still pay, because a player who is
 * out of contention for the line still has a pot to play for and should keep
 * collecting rather than quitting.
 */
export const PODIUM_BONUS: Record<number, number> = { 1: 60, 2: 40, 3: 25, 4: 15, 5: 8 };

export const ORB_BASE = 80;
export const ORB_ROLLOVER_STEP = 20;
export const ORB_MAX = 200;

/**
 * Afterburner bonus — points for fuel actually spent.
 *
 * Fuel you never burn is worth nothing, and a tank you are afraid to use makes
 * the comeback mechanic invisible. Paying a small amount for time on the boost
 * teaches the loop in one race: collect cans, spend them, go faster, score more.
 * It cannot be farmed, because the only source of fuel is cans on the track.
 */
export const BOOST_TICKS_PER_POINT = 30;
export const BOOST_POINTS_CAP = 15;

export type ScoreBreakdown = {
  racerId: string;
  name: string;
  placement: number;
  /** False when the player quit — the DNF lines are zeroed, not hidden. */
  finished: boolean;
  retired: boolean;
  progress: number;
  finish: number;
  pickups: number;
  cellsCollected: number;
  traps: number;
  cleanRun: number;
  nearMiss: number;
  nearMissCount: number;
  podium: number;
  /** Points paid for the Orb — zero unless the racer also finished. */
  orb: number;
  /** Whether the racer held the Orb at all, which a DNF needs to explain itself. */
  orbClaimed: boolean;
  boost: number;
  boostSeconds: number;
  fuelCans: number;
  stealGained: number;
  stealLost: number;
  /** Sum of everything above. Never negative. */
  total: number;
};

export function orbValue(rolloverCount: number): number {
  return Math.min(ORB_MAX, ORB_BASE + ORB_ROLLOVER_STEP * Math.max(0, rolloverCount));
}

/**
 * Score every racer in a finished race.
 *
 * Steals are modelled as transfers: the stealer gains STEAL_VALUE and the victim
 * loses the same, so points move between players rather than being minted. A
 * victim can never be driven below zero.
 *
 * Quitting (`retired`) forfeits every reward that depends on completing the
 * race — finish bonus, podium and clean run all read zero — while everything the
 * racer physically collected before bailing is kept. Cutting a bad run short is
 * a legitimate choice; it just costs you most of what the run was worth.
 */
export function scoreRace(outcome: RaceOutcome, rolloverCount = 0): ScoreBreakdown[] {
  const orbWorth = orbValue(rolloverCount);

  // Pass 1 — everything a racer earns on their own.
  const base = outcome.racers.map((r) => {
    const completed = !r.retired;

    const pickups = r.pickupPoints;
    const nearMiss = Math.min(NEAR_MISS_CAP, r.nearMisses) * NEAR_MISS_POINTS;
    const boost = Math.min(BOOST_POINTS_CAP, Math.floor(r.boostTicks / BOOST_TICKS_PER_POINT));

    /**
     * The Orb has to be carried home.
     *
     * It pays only on a completed run, and that condition is load bearing rather
     * than flavour. The Orb is worth 80–200 points and it is exclusive, so with
     * no finishing requirement the optimal line was: take the Orb, quit on the
     * spot, keep a score no honest finisher could beat, and deny it to everyone
     * else on the way out. Measured, that beat playing the race out. Requiring
     * the line turns claiming it into a commitment — you still have to survive
     * the rest of the track with it.
     */
    const orb = r.hasOrb && completed ? orbWorth : 0;

    const finish = completed ? FINISH_BONUS : 0;
    const cleanRun = r.cleanRun ? CLEAN_RUN_BONUS : 0;
    const podium = completed ? (PODIUM_BONUS[r.placement] ?? PODIUM_BONUS[5]) : 0;

    return {
      racer: r,
      finish,
      pickups,
      nearMiss,
      nearMissCount: Math.min(NEAR_MISS_CAP, r.nearMisses),
      cleanRun,
      podium,
      orb,
      boost,
      earned: finish + pickups + nearMiss + cleanRun + podium + orb + boost,
    };
  });

  // Pass 2 — apply steal transfers.
  //
  // The finish bonus is protected: a steal can take everything a racer earned
  // above it, but never the floor. Being robbed twice is exactly the case that
  // would otherwise leave a finisher with nothing.
  return base.map((b) => {
    const steals = Math.min(MAX_STEALS, b.racer.steals);
    const gained = steals * STEAL_VALUE;

    // Losses are capped at the same 2 steals a player is allowed to LAND.
    // Without this, four rivals landing two steals each could take 120 points
    // off one racer — the cap has to be symmetric or being targeted is ruinous.
    const stealable = Math.max(0, b.earned - b.finish);
    const lost = Math.min(Math.min(MAX_STEALS, b.racer.stolenFrom) * STEAL_VALUE, stealable);

    return {
      racerId: b.racer.id,
      name: b.racer.name,
      placement: b.racer.placement,
      finished: b.racer.finished,
      retired: b.racer.retired,
      progress: b.racer.progress,
      finish: b.finish,
      pickups: b.pickups,
      cellsCollected: b.racer.cellsCollected,
      traps: b.racer.traps,
      cleanRun: b.cleanRun,
      nearMiss: b.nearMiss,
      nearMissCount: b.nearMissCount,
      podium: b.podium,
      orb: b.orb,
      orbClaimed: b.racer.hasOrb,
      boost: b.boost,
      boostSeconds: b.racer.boostTicks / 60,
      fuelCans: b.racer.fuelCans,
      stealGained: gained,
      stealLost: lost,
      total: Math.max(0, b.earned + gained - lost),
    } satisfies ScoreBreakdown;
  });
}

export function findRacer(outcome: RaceOutcome, racerId: string): RaceResultRacer | undefined {
  return outcome.racers.find((r) => r.id === racerId);
}

export type BreakdownRow = {
  label: string;
  value: number;
  hint?: string;
  /** True for a line the player forfeited by quitting — rendered as a zero. */
  forfeited?: boolean;
};

/** Rows for the Results screen, in display order. */
export function breakdownRows(b: ScoreBreakdown): BreakdownRow[] {
  const dnf = b.retired;
  const rows: BreakdownRow[] = [
    {
      label: 'Finish',
      value: b.finish,
      hint: dnf ? 'Forfeited — you left the race' : 'Crossed the line',
      forfeited: dnf,
    },
    {
      label: 'Point cells',
      value: b.pickups,
      hint: b.traps
        ? `${b.cellsCollected} collected · ${b.traps} trap${b.traps > 1 ? 's' : ''} hit`
        : `${b.cellsCollected} collected`,
    },
  ];

  if (b.boost) {
    rows.push({
      label: 'Afterburner',
      value: b.boost,
      hint: `${b.boostSeconds.toFixed(1)}s on boost · ${b.fuelCans} cans`,
    });
  }
  if (b.nearMiss) {
    rows.push({ label: 'Near misses', value: b.nearMiss, hint: `${b.nearMissCount} close calls` });
  }
  if (b.stealGained) {
    rows.push({ label: 'Steals', value: b.stealGained, hint: 'Overtakes at checkpoints' });
  }
  if (b.stealLost) rows.push({ label: 'Stolen from you', value: -b.stealLost });
  if (b.orb) {
    rows.push({ label: 'Jackpot Orb', value: b.orb, hint: 'Claimed it, and carried it home' });
  } else if (dnf && b.orbClaimed) {
    // Shown as an explicit zero, not hidden: leaving with the Orb is the single
    // most expensive thing a player can do, and they need to see the number.
    rows.push({
      label: 'Jackpot Orb',
      value: 0,
      hint: 'Forfeited — the Orb only pays if you finish',
      forfeited: true,
    });
  }

  rows.push({
    label: 'Clean run',
    value: b.cleanRun,
    hint: dnf ? 'Forfeited' : 'No hard barrier hits',
    forfeited: dnf || b.cleanRun === 0,
  });
  rows.push({
    label: dnf ? 'Finish position' : `Finish position (${ordinal(b.placement)})`,
    value: b.podium,
    hint: dnf ? 'Forfeited — a DNF does not place' : 'Worth having, never enough on its own',
    forfeited: dnf,
  });

  return rows;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
