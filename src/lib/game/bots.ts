/**
 * Bot racers.
 *
 * Judging will almost certainly happen without five live humans in a lobby, so
 * empty slots fill with bots. They read the same track the player does and steer
 * by sampling candidate lanes: score each by incoming danger and by how close it
 * sits to a collectible, then move toward the best one. Skill is a single dial
 * controlling lookahead, aim noise and greed.
 */

import { TRACK_WIDTH, PLAYER_RADIUS, type Input, type RacerState, type Track } from './types';
import { obstacleX, obstacleActive } from './trackgen';
import { makeRng, type Rng } from './rng';
import { TICK_DT, BOOSTS_PER_RACE } from './engine';

export type BotSkill = 'rookie' | 'steady' | 'sharp';

export type BotProfile = {
  /** How far down the track it plans, in units. */
  lookahead: number;
  /** Random lateral wobble — lower is more precise. */
  noise: number;
  /** Willingness to detour for shards and the orb. */
  greed: number;
  /** Ticks between re-decisions; higher feels more human. */
  reactionTicks: number;
};

export const BOT_PROFILES: Record<BotSkill, BotProfile> = {
  rookie: { lookahead: 230, noise: 0.34, greed: 1.6, reactionTicks: 8 },
  steady: { lookahead: 320, noise: 0.16, greed: 2.6, reactionTicks: 4 },
  sharp: { lookahead: 410, noise: 0.05, greed: 3.4, reactionTicks: 2 },
};

export const BOT_NAMES = [
  'Vex', 'Nimbus', 'Kestrel', 'Rook', 'Piper', 'Onyx', 'Wren', 'Cobalt',
  'Juno', 'Ash', 'Mika', 'Dart',
];

const LANE_SAMPLES = 15;

export class BotController {
  private rng: Rng;
  private profile: BotProfile;
  private targetX: number;
  private ticksToDecision = 0;
  private boostFired = 0;

  constructor(seed: number, public skill: BotSkill = 'steady') {
    this.rng = makeRng(seed);
    this.profile = BOT_PROFILES[skill];
    this.targetX = TRACK_WIDTH / 2;
  }

  decide(self: RacerState, track: Track, tick: number, claimedShards: Set<number>, orbTaken: boolean): Input {
    const t = tick * TICK_DT;

    if (this.ticksToDecision <= 0) {
      this.targetX = this.chooseLane(self, track, t, claimedShards, orbTaken);
      this.ticksToDecision = this.profile.reactionTicks;
    }
    this.ticksToDecision--;

    const delta = this.targetX - self.x;
    const lateral = Math.max(-1, Math.min(1, delta / 38)) +
      (this.rng() - 0.5) * this.profile.noise;

    // Boost on the clear run-out, and once mid-race when unobstructed.
    let boost = false;
    const nearEnd = self.y > track.length * 0.86;
    if (this.boostFired < BOOSTS_PER_RACE && self.stunTicks <= 0) {
      if (nearEnd || (self.y > track.length * 0.45 && this.dangerAt(self.x, self.y, track, t) === 0 && this.rng() < 0.02)) {
        boost = true;
        this.boostFired++;
      }
    }

    return { lateral: Math.max(-1, Math.min(1, lateral)), boost };
  }

  /** Sample lanes across the track and pick the best-scoring one. */
  private chooseLane(
    self: RacerState,
    track: Track,
    t: number,
    claimedShards: Set<number>,
    orbTaken: boolean,
  ): number {
    let bestX = self.x;
    let bestScore = -Infinity;

    // Evenly-spaced lanes are ~70 units apart — coarser than the pickup radius,
    // so a shard can sit between two samples and never be aimed at. Add the exact
    // x of every reachable pickup as a candidate lane.
    const candidates: number[] = [];
    for (let i = 0; i < LANE_SAMPLES; i++) {
      candidates.push(PLAYER_RADIUS + ((TRACK_WIDTH - PLAYER_RADIUS * 2) * i) / (LANE_SAMPLES - 1));
    }
    for (const sh of track.shards) {
      if (claimedShards.has(sh.id)) continue;
      const dy = sh.y - self.y;
      if (dy > -40 && dy < this.profile.lookahead * 2.2) candidates.push(sh.x);
    }
    if (track.orb && !orbTaken) {
      const dy = track.orb.y - self.y;
      if (dy > -40 && dy < this.profile.lookahead * 3) candidates.push(track.orb.x);
    }

    for (const raw of candidates) {
      const x = Math.max(PLAYER_RADIUS, Math.min(TRACK_WIDTH - PLAYER_RADIUS, raw));

      const danger = this.dangerAlongPath(x, self, track, t);

      // Reward proximity to uncollected pickups within the planning window.
      // Falls off sharply so the score rewards actually intercepting a shard,
      // not merely drifting toward it.
      let reward = 0;
      for (const sh of track.shards) {
        if (claimedShards.has(sh.id)) continue;
        const dy = sh.y - self.y;
        if (dy < -40 || dy > this.profile.lookahead * 2.2) continue;
        // Closer shards matter more than distant ones.
        const urgency = 1 - Math.min(1, Math.max(0, dy) / (this.profile.lookahead * 2.2));
        const aim = Math.max(0, 1 - Math.abs(sh.x - x) / 140);
        reward += aim * (0.45 + urgency) * this.profile.greed * (sh.isTrap ? 0.2 : 1);
      }
      if (track.orb && !orbTaken && t >= track.orb.activateAt) {
        const dy = track.orb.y - self.y;
        if (dy > -60 && dy < this.profile.lookahead * 3) {
          const urgency = 1 - Math.min(1, Math.max(0, dy) / (this.profile.lookahead * 3));
          reward += Math.max(0, 1 - Math.abs(track.orb.x - x) / 170) * (0.5 + urgency) * this.profile.greed * 3.5;
        }
      }

      // Mild preference for not swerving across the whole track.
      const travelCost = Math.abs(x - self.x) / TRACK_WIDTH * 0.6;

      const score = reward - danger * 4.4 - travelCost;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }

    return bestX;
  }

  /**
   * Danger of holding lane `x` for the whole planning window.
   *
   * Rather than sampling danger at a few fixed points ahead — which leaves blind
   * spots between samples wide enough to hide an entire gate — this walks every
   * obstacle in range and predicts exactly when the racer will reach it, then
   * evaluates that obstacle at its own arrival time. Nothing in the window can
   * be missed, and moving obstacles are judged where they will actually be.
   */
  private dangerAlongPath(x: number, self: RacerState, track: Track, t: number): number {
    const speed = Math.max(1, self.speed);
    const window = this.profile.lookahead;
    let danger = 0;

    for (const o of track.obstacles) {
      const dy = o.y - self.y;
      if (dy < -PLAYER_RADIUS || dy > window) continue;

      const arrivalT = t + Math.max(0, dy) / speed;
      if (!obstacleActive(o, arrivalT)) continue;

      // Imminent threats outweigh distant ones.
      const urgency = 0.4 + (1 - Math.min(1, Math.max(0, dy) / window));
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
