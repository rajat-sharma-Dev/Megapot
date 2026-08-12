/** Shared geometry and race types. The engine is headless — no DOM types here. */

/** Track is a vertical corridor. x is lateral [0, TRACK_WIDTH], y is progress. */
export const TRACK_WIDTH = 1000;

/** Player collision radius, in track units. */
export const PLAYER_RADIUS = 22;

export type ObstacleKind = 'blade' | 'gate' | 'platform' | 'wall' | 'spike';

/** Severity determines the penalty on contact. */
export type BarrierClass = 'soft' | 'hard';

/**
 * An obstacle is a pure function of time: its position at tick t is computed
 * from its parameters, never stored. That keeps the simulation deterministic
 * and lets any client reconstruct the exact track from the seed alone.
 */
export type Obstacle = {
  id: number;
  kind: ObstacleKind;
  barrier: BarrierClass;
  /** Centre position along the track. */
  y: number;
  /** Base lateral centre. */
  x: number;
  /** Half-width and half-height of the axis-aligned box. */
  halfW: number;
  halfH: number;
  /** Lateral oscillation amplitude (0 = static). */
  amp: number;
  /** Oscillation speed, radians per second. */
  speed: number;
  /** Phase offset, radians. */
  phase: number;
  /** For 'gate': the opening half-width the player must pass through. */
  gapHalf?: number;
  /** For 'platform'/'spike': duty cycle — fraction of the period the hazard is active. */
  duty?: number;
};

/**
 * What driving through a pickup gives you.
 *
 *  · 'cell'  — points, the leaderboard currency.
 *  · 'fuel'  — boost fuel, the comeback currency.
 *  · 'trap'  — looks like a cell, costs points. Punishes grabbing blindly.
 */
export type PickupKind = 'cell' | 'fuel' | 'trap';

export type Pickup = {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
  /** Points for 'cell'/'trap' (trap is a cost), fuel units for 'fuel'. */
  value: number;
};

/**
 * Pickup payouts. They live here, with no imports above them, because both the
 * track generator that places pickups and the engine that consumes them need
 * the same numbers and neither should own them.
 */
export const CELL_VALUE = 10;
export const TRAP_COST = 12;
export const FUEL_CAN_VALUE = 32;

export type OrbSpawn = {
  /** Track position where the Jackpot Orb appears. */
  x: number;
  y: number;
  /** Seconds into the race before it lights up. */
  activateAt: number;
};

export type SectionInstance = {
  templateId: string;
  name: string;
  startY: number;
  length: number;
  obstacles: Obstacle[];
};

export type Track = {
  seed: number;
  length: number;
  sections: SectionInstance[];
  obstacles: Obstacle[];
  pickups: Pickup[];
  /** Checkpoint y-positions where steals are allowed. */
  stealZones: number[];
  orb: OrbSpawn | null;
};

/**
 * One tick of player intent.
 *
 * `boost` is HELD, not a one-shot: it burns fuel for as long as it is down and
 * does nothing once the tank is empty.
 */
export type Input = {
  lateral: number;
  boost: boolean;
};

export type RacerState = {
  id: string;
  name: string;
  isBot: boolean;
  x: number;
  y: number;
  /** Current forward speed, units/sec. */
  speed: number;
  finished: boolean;
  finishTick: number | null;
  /**
   * Set when the player bailed out mid-race. A retired racer stops moving and
   * forfeits everything that depends on completing the race.
   */
  retired: boolean;
  retiredTick: number | null;
  /** Ticks remaining of the stun/slow applied by a hard hit. */
  stunTicks: number;
  hardHits: number;
  softHits: number;
  /** Boost fuel, 0..FUEL_MAX. Spent by holding boost, refilled only by cans. */
  fuel: number;
  /** Ticks spent boosting — drives the HUD flame and the afterburner stat. */
  boostTicks: number;
  collectedPickupIds: number[];
  /** Net points from cells minus traps. */
  pickupPoints: number;
  cellsCollected: number;
  fuelCansCollected: number;
  trapsHit: number;
  hasOrb: boolean;
  nearMisses: number;
  /** Steal events this racer landed. */
  steals: number;
  /** Points taken from this racer by others. */
  stolenFrom: number;
  /** Checkpoints already used for a steal, so each fires at most once. */
  stealZonesUsed: number[];
};

export type RaceResultRacer = {
  id: string;
  name: string;
  isBot: boolean;
  placement: number;
  finishTick: number | null;
  finished: boolean;
  /** True when the racer quit. Mutually exclusive with `finished`. */
  retired: boolean;
  hardHits: number;
  cleanRun: boolean;
  pickupPoints: number;
  cellsCollected: number;
  fuelCans: number;
  traps: number;
  boostTicks: number;
  hasOrb: boolean;
  nearMisses: number;
  steals: number;
  stolenFrom: number;
  /** Fraction of the track covered, 0..1. Ranks racers who never finished. */
  progress: number;
};

export type RaceOutcome = {
  seed: number;
  ticks: number;
  racers: RaceResultRacer[];
};
