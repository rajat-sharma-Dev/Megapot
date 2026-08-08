/**
 * Deterministic race engine.
 *
 * Pure simulation with no DOM or timing dependencies: the same seed and the same
 * input sequence always produce the same outcome. That is what lets the server
 * re-simulate a submitted race to verify a score, and what lets the test harness
 * run thousands of full races in Node.
 *
 * The renderer draws this state; it never owns it.
 */

import {
  TRACK_WIDTH,
  PLAYER_RADIUS,
  type Input,
  type RacerState,
  type Track,
  type RaceOutcome,
  type RaceResultRacer,
} from './types';
import { obstacleX, obstacleActive } from './trackgen';

export const TICK_HZ = 60;
export const TICK_DT = 1 / TICK_HZ;

/** Forward speed, track units per second. Tuned so a race lasts 60–90s. */
export const BASE_SPEED = 130;
export const LATERAL_SPEED = 300;

/** Hard hit: stunned, then recovers. Soft hit: slowed while overlapping. */
export const HARD_HIT_STUN_TICKS = 36; // 0.6s
export const HARD_HIT_SPEED_MULT = 0.35;
export const SOFT_HIT_SPEED_MULT = 0.62;

export const BOOST_TICKS = 60;
export const BOOST_MULT = 1.55;
export const BOOSTS_PER_RACE = 2;

/**
 * Pickup radii are generous relative to the player radius (22). Collecting a
 * number is the point of the game — it should reward heading for a Shard, not
 * demand pixel-perfect alignment while dodging a blade.
 */
export const SHARD_PICKUP_RADIUS = 62;
export const ORB_PICKUP_RADIUS = 74;
/** Passing this close to a hard barrier without touching it is a near miss. */
export const NEAR_MISS_RADIUS = 40;
export const MAX_STEALS_PER_RACE = 2;

/** Safety valve so a stuck simulation can never hang the server. */
export const MAX_TICKS = TICK_HZ * 240;

export type RaceSimState = {
  track: Track;
  tick: number;
  racers: RacerState[];
  /** Crossing order per steal zone, for overtake detection. */
  checkpointOrder: string[][];
  /**
   * Shards collected, per racer.
   *
   * Deliberately NOT exclusive: every racer can collect every Shard. Each player
   * is building their own lottery ticket, so the numbers have to be personally
   * earnable — if Shards were first-come, five racers would split six of them
   * and almost nobody would finish with a full set of earned numbers.
   *
   * The Golden Orb is the opposite: exactly one racer can claim it. That is what
   * makes it the contested moment of the race.
   */
  claimedShards: Map<string, Set<number>>;
  orbClaimedBy: string | null;
  /** Live feed for the HUD: steals, orb grabs, hits. */
  events: RaceEvent[];
  boostTicksLeft: Map<string, number>;
};

export type RaceEvent =
  | { tick: number; type: 'shard'; racerId: string; number: number; isTrap: boolean }
  | { tick: number; type: 'orb'; racerId: string; bonusball: number }
  | { tick: number; type: 'steal'; racerId: string; victimId: string }
  | { tick: number; type: 'hard_hit'; racerId: string }
  | { tick: number; type: 'near_miss'; racerId: string }
  | { tick: number; type: 'finish'; racerId: string; placement: number };

export type RacerSpec = { id: string; name: string; isBot: boolean };

export function createRaceState(track: Track, specs: RacerSpec[]): RaceSimState {
  const lanes = specs.length;
  const racers: RacerState[] = specs.map((s, i) => ({
    id: s.id,
    name: s.name,
    isBot: s.isBot,
    // Spawn evenly across the start line.
    x: (TRACK_WIDTH / (lanes + 1)) * (i + 1),
    y: 0,
    speed: BASE_SPEED,
    finished: false,
    finishTick: null,
    stunTicks: 0,
    hardHits: 0,
    softHits: 0,
    collectedShardIds: [],
    collectedNumbers: [],
    hasOrb: false,
    bonusball: null,
    nearMisses: 0,
    steals: 0,
    stolenFrom: 0,
    boostsLeft: BOOSTS_PER_RACE,
    stealZonesUsed: [],
  }));

  return {
    track,
    tick: 0,
    racers,
    checkpointOrder: track.stealZones.map(() => []),
    claimedShards: new Map(specs.map((s) => [s.id, new Set<number>()])),
    orbClaimedBy: null,
    events: [],
    boostTicksLeft: new Map(specs.map((s) => [s.id, 0])),
  };
}

/** Advance the simulation one tick. Inputs are keyed by racer id. */
export function step(state: RaceSimState, inputs: Map<string, Input>): void {
  const t = state.tick * TICK_DT;
  const { track } = state;

  for (const r of state.racers) {
    if (r.finished) continue;
    const input = inputs.get(r.id) ?? { lateral: 0, boost: false };

    // ── Boost ────────────────────────────────────────────────────────────
    let boostLeft = state.boostTicksLeft.get(r.id) ?? 0;
    if (input.boost && boostLeft <= 0 && r.boostsLeft > 0 && r.stunTicks <= 0) {
      r.boostsLeft--;
      boostLeft = BOOST_TICKS;
    }
    if (boostLeft > 0) boostLeft--;
    state.boostTicksLeft.set(r.id, boostLeft);

    // ── Lateral movement ─────────────────────────────────────────────────
    const lateralMult = r.stunTicks > 0 ? 0.4 : 1;
    r.x += Math.max(-1, Math.min(1, input.lateral)) * LATERAL_SPEED * TICK_DT * lateralMult;
    r.x = Math.max(PLAYER_RADIUS, Math.min(TRACK_WIDTH - PLAYER_RADIUS, r.x));

    // ── Collision ────────────────────────────────────────────────────────
    let speedMult = 1;
    let softHit = false;
    let nearMiss = false;

    for (const o of track.obstacles) {
      // Only obstacles near the racer can matter this tick.
      if (Math.abs(o.y - r.y) > o.halfH + PLAYER_RADIUS + NEAR_MISS_RADIUS) continue;
      if (!obstacleActive(o, t)) continue;

      const ox = obstacleX(o, t);
      const dy = Math.abs(o.y - r.y);
      const overlapY = dy <= o.halfH + PLAYER_RADIUS;

      if (o.kind === 'gate' && o.gapHalf !== undefined) {
        // A gate spans the track; only the moving gap is safe.
        if (overlapY) {
          const insideGap = Math.abs(r.x - ox) <= o.gapHalf - PLAYER_RADIUS * 0.5;
          if (!insideGap) {
            if (r.stunTicks <= 0) registerHardHit(state, r);
            speedMult = Math.min(speedMult, HARD_HIT_SPEED_MULT);
          } else if (Math.abs(Math.abs(r.x - ox) - o.gapHalf) < NEAR_MISS_RADIUS) {
            nearMiss = true;
          }
        }
        continue;
      }

      const dx = Math.abs(r.x - ox);
      const hit = overlapY && dx <= o.halfW + PLAYER_RADIUS;

      if (hit) {
        if (o.barrier === 'hard') {
          if (r.stunTicks <= 0) registerHardHit(state, r);
          speedMult = Math.min(speedMult, HARD_HIT_SPEED_MULT);
        } else {
          softHit = true;
          speedMult = Math.min(speedMult, SOFT_HIT_SPEED_MULT);
        }
      } else if (
        o.barrier === 'hard' &&
        overlapY &&
        dx <= o.halfW + PLAYER_RADIUS + NEAR_MISS_RADIUS
      ) {
        nearMiss = true;
      }
    }

    if (softHit) r.softHits++;
    if (nearMiss && r.stunTicks <= 0) {
      r.nearMisses++;
      state.events.push({ tick: state.tick, type: 'near_miss', racerId: r.id });
    }

    // ── Forward movement ─────────────────────────────────────────────────
    if (r.stunTicks > 0) {
      r.stunTicks--;
      speedMult = Math.min(speedMult, HARD_HIT_SPEED_MULT);
    }
    if (boostLeft > 0) speedMult *= BOOST_MULT;

    r.speed = BASE_SPEED * speedMult;
    r.y += r.speed * TICK_DT;

    // ── Pickups ──────────────────────────────────────────────────────────
    collectShards(state, r);
    collectOrb(state, r, t);

    // ── Checkpoints & steals ─────────────────────────────────────────────
    checkStealZones(state, r);

    // ── Finish ───────────────────────────────────────────────────────────
    if (r.y >= track.length) {
      r.finished = true;
      r.finishTick = state.tick;
      const placement = state.racers.filter((x) => x.finished).length;
      state.events.push({ tick: state.tick, type: 'finish', racerId: r.id, placement });
    }
  }

  state.tick++;
}

function registerHardHit(state: RaceSimState, r: RacerState) {
  r.hardHits++;
  r.stunTicks = HARD_HIT_STUN_TICKS;
  state.events.push({ tick: state.tick, type: 'hard_hit', racerId: r.id });
}

function collectShards(state: RaceSimState, r: RacerState) {
  const mine = state.claimedShards.get(r.id);
  if (!mine) return;

  for (const s of state.track.shards) {
    if (mine.has(s.id)) continue;
    if (Math.abs(s.y - r.y) > SHARD_PICKUP_RADIUS) continue;
    if (Math.abs(s.x - r.x) > SHARD_PICKUP_RADIUS) continue;

    mine.add(s.id);
    r.collectedShardIds.push(s.id);
    r.collectedNumbers.push(s.number);
    state.events.push({
      tick: state.tick, type: 'shard', racerId: r.id, number: s.number, isTrap: s.isTrap,
    });
  }
}

function collectOrb(state: RaceSimState, r: RacerState, t: number) {
  const orb = state.track.orb;
  if (!orb || state.orbClaimedBy) return;
  if (t < orb.activateAt) return;
  if (Math.abs(orb.y - r.y) > ORB_PICKUP_RADIUS) return;
  if (Math.abs(orb.x - r.x) > ORB_PICKUP_RADIUS) return;

  state.orbClaimedBy = r.id;
  r.hasOrb = true;
  r.bonusball = orb.bonusball;
  state.events.push({ tick: state.tick, type: 'orb', racerId: r.id, bonusball: orb.bonusball });
}

/**
 * Steals fire only at checkpoints, and only on a genuine overtake: you must
 * cross this checkpoint ahead of someone who was ahead of you at the last one.
 * That keeps stealing readable and skillful rather than positional luck.
 */
function checkStealZones(state: RaceSimState, r: RacerState) {
  const zones = state.track.stealZones;
  for (let k = 0; k < zones.length; k++) {
    if (r.y < zones[k]) continue;
    if (r.stealZonesUsed.includes(k)) continue;

    r.stealZonesUsed.push(k);
    const order = state.checkpointOrder[k];
    order.push(r.id);

    if (r.steals >= MAX_STEALS_PER_RACE) continue;

    // Who was ahead of us at the previous checkpoint but hasn't reached this one?
    const prev = k === 0 ? null : state.checkpointOrder[k - 1];
    for (const other of state.racers) {
      if (other.id === r.id || other.finished) continue;
      if (order.includes(other.id)) continue; // already through this checkpoint

      const wasAhead =
        prev === null
          ? other.y > r.y // first checkpoint: simple position comparison
          : prev.indexOf(other.id) !== -1 &&
            (prev.indexOf(r.id) === -1 || prev.indexOf(other.id) < prev.indexOf(r.id));

      if (wasAhead) {
        r.steals++;
        other.stolenFrom++;
        state.events.push({ tick: state.tick, type: 'steal', racerId: r.id, victimId: other.id });
        break; // one steal per checkpoint
      }
    }
  }
}

export function raceComplete(state: RaceSimState): boolean {
  return state.racers.every((r) => r.finished) || state.tick >= MAX_TICKS;
}

/** Freeze the simulation into a result. Unfinished racers rank by distance covered. */
export function finalize(state: RaceSimState): RaceOutcome {
  const ranked = [...state.racers].sort((a, b) => {
    if (a.finished && b.finished) return (a.finishTick ?? 0) - (b.finishTick ?? 0);
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.y - a.y;
  });

  const racers: RaceResultRacer[] = ranked.map((r, i) => ({
    id: r.id,
    name: r.name,
    isBot: r.isBot,
    placement: i + 1,
    finishTick: r.finishTick,
    hardHits: r.hardHits,
    cleanRun: r.hardHits === 0,
    shardsCollected: r.collectedShardIds.length,
    collectedNumbers: r.collectedNumbers,
    hasOrb: r.hasOrb,
    bonusball: r.bonusball,
    nearMisses: r.nearMisses,
    steals: r.steals,
    stolenFrom: r.stolenFrom,
  }));

  return { seed: state.track.seed, ticks: state.tick, racers };
}
