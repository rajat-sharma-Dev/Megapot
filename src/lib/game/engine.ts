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
  FUEL_CAN_VALUE,
  type Input,
  type PickupKind,
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

/**
 * Hard hit: stunned, then recovers. Soft hit: slowed while overlapping.
 *
 * The stun is deliberately survivable. A hit used to drop you to 35% speed for
 * 0.6s with no way to answer it, which in a five-racer field meant one blade
 * ended your race — you could not catch up by driving better. It is now shorter,
 * shallower, and boost stacks on top of it (see below), so the recovery is in
 * the player's hands.
 */
export const HARD_HIT_STUN_TICKS = 30; // 0.5s
export const HARD_HIT_SPEED_MULT = 0.45;
export const SOFT_HIT_SPEED_MULT = 0.7;

/**
 * Boost is a fuel tank, not a pair of charges.
 *
 * Holding boost burns fuel and does nothing once empty; the only way to refill
 * is to drive through a fuel can. That turns the whole track into a routing
 * problem — spend now to close a gap, or bank it for the run-out — and it gives
 * a player who just ate a blade something to do about it.
 *
 * Crucially, boost multiplies through a stun instead of being locked out by it.
 * At 0.45 × 1.7 you are still below base speed, so a hit always costs you, but
 * slamming boost turns a race-ending hit into a recoverable one.
 */
export const FUEL_MAX = 100;
export const FUEL_START = 45;
export const FUEL_DRAIN_PER_SEC = 26;
export const BOOST_MULT = 1.7;

/**
 * A hard hit spills fuel.
 *
 * Without this, "hold boost and eat the hits" is not just viable but optimal. The
 * arithmetic: a second of boost gains about 91 track units, while a hard hit
 * costs roughly 36 — so a second of fuel outweighs two and a half crashes, and
 * the correct play is to accelerate blindly into everything. Measured against the
 * bot profiles, that is exactly what happened.
 *
 * Charging a quarter tank per impact makes the trade self-limiting: boost still
 * rescues a run, but crashing while you do it takes away the means to keep doing
 * it.
 *
 * KNOWN BALANCE GAP, measured rather than assumed: this reduces the advantage of
 * reckless boosting but does not eliminate it. With 13–18 cans on the track a
 * racer can absorb ~5 crashes and still afford ~15s of boost, and boost time is
 * the dominant term in finishing position — so the recklessly-boosting bot
 * profile still finishes ahead of the careful one (2.5 vs 3.3 average place over
 * 80 races). Raising this penalty to 55 barely moved that, because the constraint
 * is fuel ABUNDANCE, not the price of a crash. The real fix is to retune can
 * density against crash cost together, which needs playtesting rather than
 * another parameter sweep. Tracked in the README.
 */
export const FUEL_HIT_PENALTY = 25;
/** Re-exported for the HUD; the canonical value lives with the pickup types. */
export const FUEL_PER_CAN = FUEL_CAN_VALUE;
/** Seconds of boost a full tank buys — used by the HUD and the tests. */
export const FUEL_SECONDS_PER_TANK = FUEL_MAX / FUEL_DRAIN_PER_SEC;

/**
 * Pickup radii are generous relative to the player radius (22). Collecting is
 * the point of the game — it should reward committing to a line, not demand
 * pixel-perfect alignment while dodging a blade.
 */
export const CELL_PICKUP_RADIUS = 62;
export const FUEL_PICKUP_RADIUS = 66;
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
   * Pickups collected, per racer.
   *
   * Deliberately NOT exclusive: every racer can collect every cell and can. This
   * is a leaderboard game, so a run has to be comparable between players — your
   * score should reflect how you drove, not which bots happened to spawn ahead
   * of you and hoover up the track.
   *
   * The Jackpot Orb is the opposite: exactly one racer can claim it. That is
   * what makes it the contested moment of the race.
   */
  claimedPickups: Map<string, Set<number>>;
  orbClaimedBy: string | null;
  /** Live feed for the HUD: pickups, steals, hits. */
  events: RaceEvent[];
};

export type RaceEvent =
  | { tick: number; type: 'pickup'; racerId: string; kind: PickupKind; value: number }
  | { tick: number; type: 'orb'; racerId: string }
  | { tick: number; type: 'steal'; racerId: string; victimId: string }
  | { tick: number; type: 'hard_hit'; racerId: string }
  | { tick: number; type: 'near_miss'; racerId: string }
  | { tick: number; type: 'finish'; racerId: string; placement: number }
  | { tick: number; type: 'retire'; racerId: string };

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
    retired: false,
    retiredTick: null,
    stunTicks: 0,
    hardHits: 0,
    softHits: 0,
    fuel: FUEL_START,
    boostTicks: 0,
    collectedPickupIds: [],
    pickupPoints: 0,
    cellsCollected: 0,
    fuelCansCollected: 0,
    trapsHit: 0,
    hasOrb: false,
    nearMisses: 0,
    steals: 0,
    stolenFrom: 0,
    stealZonesUsed: [],
  }));

  return {
    track,
    tick: 0,
    racers,
    checkpointOrder: track.stealZones.map(() => []),
    claimedPickups: new Map(specs.map((s) => [s.id, new Set<number>()])),
    orbClaimedBy: null,
    events: [],
  };
}

/** True once this racer is out of the simulation, either way. */
export const isOut = (r: RacerState) => r.finished || r.retired;

/**
 * Bail out of the race.
 *
 * The racer stops where they are and keeps whatever they physically collected,
 * but forfeits the finish bonus, the podium and the clean-run bonus — see
 * `scoreRace`. Quitting is a real option (cut your losses on a bad run and
 * start another) with a real cost.
 */
export function retire(state: RaceSimState, racerId: string): void {
  const r = state.racers.find((x) => x.id === racerId);
  if (!r || isOut(r)) return;
  r.retired = true;
  r.retiredTick = state.tick;
  r.speed = 0;
  state.events.push({ tick: state.tick, type: 'retire', racerId: r.id });
}

/** Advance the simulation one tick. Inputs are keyed by racer id. */
export function step(state: RaceSimState, inputs: Map<string, Input>): void {
  const t = state.tick * TICK_DT;
  const { track } = state;

  for (const r of state.racers) {
    if (isOut(r)) continue;
    const input = inputs.get(r.id) ?? { lateral: 0, boost: false };

    // ── Boost & fuel ─────────────────────────────────────────────────────
    // Held, metered, and usable through a stun. Empty tank = no boost.
    const boosting = input.boost && r.fuel > 0;
    if (boosting) {
      r.fuel = Math.max(0, r.fuel - FUEL_DRAIN_PER_SEC * TICK_DT);
      r.boostTicks++;
    }

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
    // Boost stacks on top of any penalty rather than being cancelled by it.
    if (boosting) speedMult *= BOOST_MULT;

    r.speed = BASE_SPEED * speedMult;
    r.y += r.speed * TICK_DT;

    // ── Pickups ──────────────────────────────────────────────────────────
    collectPickups(state, r);
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
  r.fuel = Math.max(0, r.fuel - FUEL_HIT_PENALTY);
  state.events.push({ tick: state.tick, type: 'hard_hit', racerId: r.id });
}

function radiusFor(kind: PickupKind): number {
  return kind === 'fuel' ? FUEL_PICKUP_RADIUS : CELL_PICKUP_RADIUS;
}

function collectPickups(state: RaceSimState, r: RacerState) {
  const mine = state.claimedPickups.get(r.id);
  if (!mine) return;

  for (const p of state.track.pickups) {
    if (mine.has(p.id)) continue;
    const radius = radiusFor(p.kind);
    if (Math.abs(p.y - r.y) > radius) continue;
    if (Math.abs(p.x - r.x) > radius) continue;

    mine.add(p.id);
    r.collectedPickupIds.push(p.id);

    if (p.kind === 'fuel') {
      r.fuel = Math.min(FUEL_MAX, r.fuel + p.value);
      r.fuelCansCollected++;
    } else if (p.kind === 'trap') {
      r.pickupPoints -= p.value;
      r.trapsHit++;
    } else {
      r.pickupPoints += p.value;
      r.cellsCollected++;
    }

    state.events.push({
      tick: state.tick, type: 'pickup', racerId: r.id, kind: p.kind, value: p.value,
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
  state.events.push({ tick: state.tick, type: 'orb', racerId: r.id });
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
      if (other.id === r.id || isOut(other)) continue;
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
  return state.racers.every(isOut) || state.tick >= MAX_TICKS;
}

/**
 * Freeze the simulation into a result.
 *
 * Order: everyone who crossed the line (by time), then anyone still driving
 * when the clock ran out (by distance), then anyone who quit (by distance).
 * Quitting always costs you position as well as the finish bonus.
 */
export function finalize(state: RaceSimState): RaceOutcome {
  const rank = (r: RacerState) => (r.finished ? 0 : r.retired ? 2 : 1);

  const ranked = [...state.racers].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.finished && b.finished) return (a.finishTick ?? 0) - (b.finishTick ?? 0);
    return b.y - a.y;
  });

  const racers: RaceResultRacer[] = ranked.map((r, i) => ({
    id: r.id,
    name: r.name,
    isBot: r.isBot,
    placement: i + 1,
    finishTick: r.finishTick,
    finished: r.finished,
    retired: r.retired,
    hardHits: r.hardHits,
    // A clean run means you got to the end untouched. Quitting is not clean.
    cleanRun: r.finished && r.hardHits === 0,
    pickupPoints: r.pickupPoints,
    cellsCollected: r.cellsCollected,
    fuelCans: r.fuelCansCollected,
    traps: r.trapsHit,
    boostTicks: r.boostTicks,
    hasOrb: r.hasOrb,
    nearMisses: r.nearMisses,
    steals: r.steals,
    stolenFrom: r.stolenFrom,
    progress: Math.max(0, Math.min(1, r.y / state.track.length)),
  }));

  return { seed: state.track.seed, ticks: state.tick, racers };
}
