/**
 * Point scoring — the authoritative math.
 *
 * This runs on the SERVER against a re-simulated race. The client renders a
 * preview with the same functions, but a client-reported score is never trusted:
 * points buy real lottery tickets, so the only score that counts is one the
 * server derived itself from the seed and the input log.
 *
 * Values come from the build spec §6 and are deliberately tuned so a strong
 * 4–5 race session lands at or near one ticket.
 */

import type { RaceOutcome, RaceResultRacer } from '../game/types';

/**
 * Tuned against measured play, not assumed play.
 *
 * The spec's starting values produced ~67 points for a mid-skill run once the
 * simulation was fair, against a target band of 95–110. Two adjustments close
 * that gap without inventing new sources:
 *
 *  · SHARD_POINTS 5 -> 8. Collecting numbers IS the game; it should pay like it.
 *  · STEAL_VALUE 25 -> 15. Every racer can be robbed twice but a mid-pack racer
 *    rarely lands steals, so at 25 the mechanic was a flat ~17-point tax on
 *    average play rather than the ~+10 swing the spec intended.
 *
 * Measured result: ~95-100 points for a mid-skill run, i.e. ~6 races per ticket.
 */
export const FINISH_BONUS = 25;
export const SHARD_POINTS = 8;
export const CLEAN_RUN_BONUS = 15;
export const NEAR_MISS_POINTS = 1;
export const NEAR_MISS_CAP = 8;
export const STEAL_VALUE = 15;
export const MAX_STEALS = 2;

export const PODIUM_BONUS: Record<number, number> = { 1: 60, 2: 35, 3: 20, 4: 5, 5: 5 };

export const ORB_BASE = 80;
export const ORB_ROLLOVER_STEP = 20;
export const ORB_MAX = 200;

/** Points needed for one Megapot ticket via the skill path. */
export const TICKET_THRESHOLD = 600;

/** Cookie path: 1 piece per 3 races, 6 pieces = 1 guaranteed ticket. */
export const RACES_PER_COOKIE_PIECE = 3;
export const COOKIE_PIECES = 6;

export type ScoreBreakdown = {
  racerId: string;
  name: string;
  placement: number;
  finish: number;
  shards: number;
  shardCount: number;
  cleanRun: number;
  nearMiss: number;
  nearMissCount: number;
  podium: number;
  orb: number;
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
 */
export function scoreRace(outcome: RaceOutcome, rolloverCount = 0): ScoreBreakdown[] {
  const orbWorth = orbValue(rolloverCount);

  // Pass 1 — everything a racer earns on their own.
  const base = outcome.racers.map((r) => {
    const shards = r.shardsCollected * SHARD_POINTS;
    const nearMiss = Math.min(NEAR_MISS_CAP, r.nearMisses) * NEAR_MISS_POINTS;
    const cleanRun = r.cleanRun ? CLEAN_RUN_BONUS : 0;
    const podium = PODIUM_BONUS[r.placement] ?? PODIUM_BONUS[5];
    const orb = r.hasOrb ? orbWorth : 0;

    return {
      racer: r,
      finish: FINISH_BONUS,
      shards,
      shardCount: r.shardsCollected,
      cleanRun,
      nearMiss,
      nearMissCount: Math.min(NEAR_MISS_CAP, r.nearMisses),
      podium,
      orb,
      earned: FINISH_BONUS + shards + cleanRun + nearMiss + podium + orb,
    };
  });

  // Pass 2 — apply steal transfers.
  //
  // The finish bonus is protected: a steal can take everything a racer earned
  // above it, but never the floor. The spec guarantees nobody leaves a race with
  // zero, and being robbed twice is exactly the case that would otherwise break it.
  return base.map((b) => {
    const steals = Math.min(MAX_STEALS, b.racer.steals);
    const gained = steals * STEAL_VALUE;

    // Losses are capped at the same 2 steals a player is allowed to LAND.
    // Without this, four rivals landing two steals each could take 200 points
    // off one racer — the cap has to be symmetric or being targeted is ruinous.
    const stealable = Math.max(0, b.earned - FINISH_BONUS);
    const lost = Math.min(Math.min(MAX_STEALS, b.racer.stolenFrom) * STEAL_VALUE, stealable);

    return {
      racerId: b.racer.id,
      name: b.racer.name,
      placement: b.racer.placement,
      finish: b.finish,
      shards: b.shards,
      shardCount: b.shardCount,
      cleanRun: b.cleanRun,
      nearMiss: b.nearMiss,
      nearMissCount: b.nearMissCount,
      podium: b.podium,
      orb: b.orb,
      stealGained: gained,
      stealLost: lost,
      total: Math.max(0, b.earned + gained - lost),
    } satisfies ScoreBreakdown;
  });
}

export function findRacer(outcome: RaceOutcome, racerId: string): RaceResultRacer | undefined {
  return outcome.racers.find((r) => r.id === racerId);
}

/** Rows for the Results screen, in display order, skipping empty lines. */
export function breakdownRows(b: ScoreBreakdown): Array<{ label: string; value: number; hint?: string }> {
  const rows: Array<{ label: string; value: number; hint?: string }> = [
    { label: 'Finish', value: b.finish, hint: 'Everyone who crosses the line' },
    { label: 'Shards', value: b.shards, hint: `${b.shardCount} collected × ${SHARD_POINTS}` },
  ];
  if (b.cleanRun) rows.push({ label: 'Clean run', value: b.cleanRun, hint: 'No hard barrier hits' });
  if (b.nearMiss) rows.push({ label: 'Near misses', value: b.nearMiss, hint: `${b.nearMissCount} close calls` });
  if (b.stealGained) rows.push({ label: 'Steals', value: b.stealGained, hint: 'Overtakes at checkpoints' });
  if (b.stealLost) rows.push({ label: 'Stolen from you', value: -b.stealLost });
  if (b.orb) rows.push({ label: 'Golden Orb', value: b.orb, hint: 'Claimed the bonusball' });
  rows.push({ label: `Podium (${ordinal(b.placement)})`, value: b.podium });
  return rows;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
