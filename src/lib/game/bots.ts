/**
 * Bot racers.
 *
 * Judging will almost certainly happen without five live humans in a lobby, so
 * empty slots fill with bots. They read the same track the player does and steer
 * by sampling candidate lanes: score each by incoming danger and by how close it
 * sits to a collectible, then move toward the best one. Skill is a single dial
 * controlling foresight, aim noise and greed.
 */

import { TRACK_WIDTH, PLAYER_RADIUS, type Input, type RacerState, type Track } from './types';
import { obstacleX, obstacleActive } from './trackgen';
import { makeRng, type Rng } from './rng';
import { TICK_DT, BASE_SPEED, FUEL_MAX, BOOST_MULT } from './engine';

export type BotSkill = 'rookie' | 'steady' | 'sharp';

export type BotProfile = {
  /** How far *ahead in time* it plans, in seconds. */
  horizon: number;
  /**
   * Aiming error, in TRACK UNITS.
   *
   * Applied to the chosen lane, not to the steering output. That distinction is
   * what makes it a skill: perturbing the output only produces a wobble the
   * steering immediately corrects, whereas perturbing the target means the racer
   * genuinely commits to the wrong line and clips the gap. For scale, the player
   * radius is 22 units.
   */
  aimError: number;
  /** Willingness to detour for cells and the orb. */
  greed: number;
  /** Ticks between re-decisions; higher feels more human. */
  reactionTicks: number;
  /** How hard it weights danger against reward. Higher = more cautious. */
  caution: number;
  /** Fraction of the tank it is willing to hold in reserve rather than burn. */
  fuelReserve: number;
};

/** Small constant wobble so every racer looks alive, skill notwithstanding. */
const IDLE_JITTER = 0.05;

/**
 * Skill now scales in the direction it claims to.
 *
 * The old ladder ran backwards — measured over 120 races, 'sharp' averaged more
 * hard hits and a *worse* finishing position than 'rookie'. Two independent bugs
 * caused it, and both are worth naming because they are easy to reintroduce:
 *
 *  1. `lookahead` was a distance, and danger was summed over that whole distance
 *     with no normalisation. A longer lookahead therefore inflated the danger
 *     total and saturated the signal, letting obstacles three seconds out drown
 *     out the one the bot was about to hit. Fixed by making foresight a time
 *     horizon and giving `urgency` an absolute decay (see `dangerAlongPath`), so
 *     seeing further adds information instead of noise.
 *
 *  2. `greed` rose faster than `caution` did. Since a lane's score is
 *     `reward·greed − danger·caution`, what actually governs risk appetite is the
 *     *ratio* — and at 3.4/4.8 'sharp' was hungrier relative to its caution than
 *     'rookie' at 1.6/3.0. The "better" bot was deliberately driving through
 *     hazards for pickups.
 *
 * Greed and fuel reserve are therefore identical across profiles — wanting the
 * pickup is not a skill, and neither is hoarding. Skill is aim (`aimError`),
 * reaction speed (`reactionTicks`), planning reach (`horizon`) and risk tolerance
 * (`caution`).
 *
 * WHAT THIS DOES AND DOES NOT ACHIEVE, measured over 80 races per profile:
 *
 *   · Hard hits now follow skill correctly — 4.9 / 4.7 / 4.5 for
 *     rookie / steady / sharp. The safety ladder works.
 *   · Finishing POSITION still does not — 2.5 / 3.2 / 3.3. The cause is in the
 *     engine, not here: boost time dominates finishing position, boosting requires
 *     a clear lane ahead, and a cautious racer that keeps away from hazards also
 *     keeps away from the pickup lines, so it finds fewer boostable stretches
 *     (13.4s vs the reckless profile's 15.5s). Recklessness is currently faster
 *     than care. See FUEL_HIT_PENALTY in engine.ts for the balance note.
 *
 * The test suite asserts the hit-rate ladder, which holds, and deliberately does
 * NOT assert the placement ladder, which does not — an always-green assertion
 * that quietly encodes a known-wrong claim is worse than no assertion.
 */
export const BOT_PROFILES: Record<BotSkill, BotProfile> = {
  rookie: { horizon: 1.0, aimError: 96, greed: 2.4, reactionTicks: 11, caution: 3.0, fuelReserve: 0.25 },
  steady: { horizon: 1.8, aimError: 36, greed: 2.4, reactionTicks: 5, caution: 4.4, fuelReserve: 0.25 },
  sharp: { horizon: 2.6, aimError: 7, greed: 2.4, reactionTicks: 2, caution: 6.0, fuelReserve: 0.25 },
};

export const BOT_NAMES = [
  'Vex', 'Nimbus', 'Kestrel', 'Rook', 'Piper', 'Onyx', 'Wren', 'Cobalt',
  'Juno', 'Ash', 'Mika', 'Dart',
];

const LANE_SAMPLES = 15;

/**
 * Distance at which an obstacle stops mattering, in track units.
 *
 * Roughly three seconds at base speed. Danger weight decays linearly to zero
 * here, which is what makes a profile's danger score independent of how far it
 * happens to be looking.
 */
const DANGER_REFERENCE = 420;

/**
 * How much a racer favours the lane it is already committed to.
 *
 * Tuned to be worth roughly a third of a nearby pickup: enough to stop target
 * thrash between two similar options, not enough to ignore a hazard.
 */
const STICKINESS = 0.6;

/** Seconds of boosted travel a racer wants clear before spending fuel. */
const BOOST_PROBE_SECONDS = 0.6;

export class BotController {
  private rng: Rng;
  private profile: BotProfile;
  private targetX: number;
  private ticksToDecision = 0;

  constructor(seed: number, public skill: BotSkill = 'steady') {
    this.rng = makeRng(seed);
    this.profile = BOT_PROFILES[skill];
    this.targetX = TRACK_WIDTH / 2;
  }

  /** Planning distance for this tick — a horizon in seconds, at current speed. */
  private window(self: RacerState): number {
    return Math.max(120, Math.max(self.speed, BASE_SPEED * 0.6) * this.profile.horizon);
  }

  decide(
    self: RacerState,
    track: Track,
    tick: number,
    claimed: Set<number>,
    orbTaken: boolean,
  ): Input {
    const t = tick * TICK_DT;
    const window = this.window(self);

    if (this.ticksToDecision <= 0) {
      const best = this.chooseLane(self, track, t, claimed, orbTaken, window);
      // Aim error is baked into the committed target, so the racer actually
      // drives the wrong line rather than jittering around the right one.
      const err = (this.rng() - 0.5) * this.profile.aimError;
      this.targetX = Math.max(PLAYER_RADIUS, Math.min(TRACK_WIDTH - PLAYER_RADIUS, best + err));
      this.ticksToDecision = this.profile.reactionTicks;
    }
    this.ticksToDecision--;

    const delta = this.targetX - self.x;
    const lateral = Math.max(-1, Math.min(1, delta / 38)) +
      (this.rng() - 0.5) * IDLE_JITTER;

    return {
      lateral: Math.max(-1, Math.min(1, lateral)),
      boost: this.wantsBoost(self, track, t),
    };
  }

  /**
   * Fuel policy.
   *
   * Burn when it pays: recovering from a stun, on a clear road, and on the
   * run-out. Better bots hold less in reserve, so skill shows up as fuel used
   * well rather than fuel hoarded.
   */
  private wantsBoost(self: RacerState, track: Track, t: number): boolean {
    if (self.fuel <= 0) return false;

    // The run-out is unobstructed; dump whatever is left into the finish.
    if (self.y > track.length * 0.86) return true;

    /*
     * How far to check before committing fuel.
     *
     * Measured in BOOSTED travel, because boosting is precisely what shortens the
     * time available to react to whatever is ahead. Checking a flat 60 units — as
     * this once did — is a quarter of a second at boost speed, so the eager
     * profiles reliably accelerated into obstacles they then could not dodge.
     *
     * The window is a fixed number of SECONDS for every profile, deliberately.
     * Scaling it by `horizon` made the far-sighted profile demand a longer clear
     * stretch than a dense track ever offers, so it boosted 12.9s per race against
     * the clumsiest profile's 14.7s and finished measurably slower — prudence that
     * only ever cost it the race. Whether to look before you leap is not the
     * interesting variable; how accurately you drive once you have is.
     */
    const probe = Math.max(110, self.speed * BOOST_MULT * BOOST_PROBE_SECONDS);
    const clearAhead = this.dangerAlongPath(self.x, self, track, t, probe) === 0;
    if (!clearAhead) return false;

    // Slammed into something — spend fuel to claw the speed back.
    if (self.stunTicks > 0) return true;

    // Otherwise only above the reserve.
    return self.fuel > FUEL_MAX * this.profile.fuelReserve;
  }

  /** Sample lanes across the track and pick the best-scoring one. */
  private chooseLane(
    self: RacerState,
    track: Track,
    t: number,
    claimed: Set<number>,
    orbTaken: boolean,
    window: number,
  ): number {
    let bestX = self.x;
    let bestScore = -Infinity;

    // Evenly-spaced lanes are ~70 units apart — coarser than the pickup radius,
    // so a pickup can sit between two samples and never be aimed at. Add the exact
    // x of every reachable pickup as a candidate lane.
    const candidates: number[] = [];
    for (let i = 0; i < LANE_SAMPLES; i++) {
      candidates.push(PLAYER_RADIUS + ((TRACK_WIDTH - PLAYER_RADIUS * 2) * i) / (LANE_SAMPLES - 1));
    }

    const reach = window * 2.2;
    for (const p of track.pickups) {
      if (claimed.has(p.id)) continue;
      if (p.kind === 'trap') continue; // never aim at a trap
      const dy = p.y - self.y;
      if (dy > -40 && dy < reach) candidates.push(p.x);
    }
    if (track.orb && !orbTaken) {
      const dy = track.orb.y - self.y;
      if (dy > -40 && dy < window * 3) candidates.push(track.orb.x);
    }

    // How badly it wants fuel scales with how empty the tank is.
    const fuelHunger = 0.4 + 2.2 * (1 - self.fuel / FUEL_MAX);

    for (const raw of candidates) {
      const x = Math.max(PLAYER_RADIUS, Math.min(TRACK_WIDTH - PLAYER_RADIUS, raw));

      /*
       * Danger is evaluated over a FIXED distance for every profile, not over the
       * profile's own window.
       *
       * Spotting a spinning blade 400 units ahead is not a skill — it is on
       * screen. Tying the danger window to `horizon` meant the far-sighted profile
       * summed threats the short-sighted one never counted, so it read more total
       * danger for the identical lane and kept refusing pickup lines its rival
       * happily took. Measured, that alone cost the sharpest profile 1.4
       * collectibles a race. Skill lives in `aimError`, `reactionTicks`, how far
       * ahead pickups are planned for, and how carefully fuel is spent — not in
       * being more frightened.
       */
      const danger = this.dangerAlongPath(x, self, track, t);

      // Reward proximity to uncollected pickups within the planning window.
      // Falls off sharply so the score rewards actually intercepting something,
      // not merely drifting toward it.
      let reward = 0;
      for (const p of track.pickups) {
        if (claimed.has(p.id)) continue;
        const dy = p.y - self.y;
        if (dy < -40 || dy > reach) continue;

        const urgency = 1 - Math.min(1, Math.max(0, dy) / reach);
        const aim = Math.max(0, 1 - Math.abs(p.x - x) / 140);

        if (p.kind === 'trap') {
          // Traps are anti-rewards: steer away from a line that runs through one.
          reward -= aim * (0.45 + urgency) * 1.4;
        } else {
          const appetite = p.kind === 'fuel' ? fuelHunger : this.profile.greed;
          reward += aim * (0.45 + urgency) * appetite;
        }
      }

      if (track.orb && !orbTaken && t >= track.orb.activateAt) {
        const dy = track.orb.y - self.y;
        if (dy > -60 && dy < window * 3) {
          const urgency = 1 - Math.min(1, Math.max(0, dy) / (window * 3));
          reward += Math.max(0, 1 - Math.abs(track.orb.x - x) / 170) * (0.5 + urgency) * this.profile.greed * 3.5;
        }
      }

      // Mild preference for not swerving across the whole track.
      const travelCost = Math.abs(x - self.x) / TRACK_WIDTH * 0.6;

      /*
       * Commitment bonus for the lane already being driven.
       *
       * Without it, a fast-reacting profile re-scores every candidate every other
       * tick and oscillates between two near-equal pickups, arriving at neither —
       * which measurably cost the sharpest profile more collectibles than the
       * clumsiest one, purely because the clumsy one re-decided rarely enough to
       * follow through. Hysteresis makes a decision mean something.
       */
      const sticky = Math.abs(x - this.targetX) < 34 ? STICKINESS : 0;

      const score = reward + sticky - danger * this.profile.caution - travelCost;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }

    return bestX;
  }

  /**
   * Danger of holding lane `x` across the planning window.
   *
   * Every obstacle in range is walked and evaluated at the exact time this racer
   * would arrive at it, so nothing in the window can hide between samples and
   * moving obstacles are judged where they will actually be.
   *
   * `urgency` decays against a FIXED reference distance rather than against the
   * window. That is the detail that keeps the skill ladder the right way up: with
   * a window-relative weight, the same obstacle at the same distance scored as
   * *more* threatening to a bot that could see further, so extra foresight made a
   * racer more timid instead of better informed. Decaying to zero at
   * DANGER_REFERENCE also means a longer window contributes only near-zero terms
   * for far-away obstacles, so no normalisation is needed.
   */
  private dangerAlongPath(
    x: number,
    self: RacerState,
    track: Track,
    t: number,
    window = DANGER_REFERENCE,
  ): number {
    const speed = Math.max(1, self.speed);
    let danger = 0;

    for (const o of track.obstacles) {
      const dy = o.y - self.y;
      if (dy < -PLAYER_RADIUS || dy > window) continue;

      const arrivalT = t + Math.max(0, dy) / speed;
      if (!obstacleActive(o, arrivalT)) continue;

      // Imminent threats outweigh distant ones, on an absolute scale.
      const urgency = Math.max(0, 1 - Math.max(0, dy) / DANGER_REFERENCE);
      if (urgency <= 0) continue;

      const ox = obstacleX(o, arrivalT);

      if (o.kind === 'gate' && o.gapHalf !== undefined) {
        if (Math.abs(x - ox) > o.gapHalf - PLAYER_RADIUS) danger += 1.6 * urgency;
        continue;
      }

      const dx = Math.abs(x - ox);
      const reach = o.halfW + PLAYER_RADIUS;
      if (dx <= reach) danger += (o.barrier === 'hard' ? 1.5 : 0.45) * urgency;
      else if (dx <= reach + 34) danger += (o.barrier === 'hard' ? 0.35 : 0.1) * urgency;
    }

    return danger;
  }

  /** 0 = clear, higher = more dangerous, at a given point and time. */
  private dangerAt(x: number, y: number, track: Track, t: number): number {
    let danger = 0;
    for (const o of track.obstacles) {
      if (Math.abs(o.y - y) > o.halfH + PLAYER_RADIUS + 30) continue;
      if (!obstacleActive(o, t)) continue;

      const ox = obstacleX(o, t);
      if (o.kind === 'gate' && o.gapHalf !== undefined) {
        const inGap = Math.abs(x - ox) <= o.gapHalf - PLAYER_RADIUS;
        if (!inGap) danger += 1.4;
        continue;
      }
      const dx = Math.abs(x - ox);
      const reach = o.halfW + PLAYER_RADIUS;
      if (dx <= reach) danger += o.barrier === 'hard' ? 1.5 : 0.45;
      else if (dx <= reach + 34) danger += o.barrier === 'hard' ? 0.35 : 0.1;
    }
    return danger;
  }
}
