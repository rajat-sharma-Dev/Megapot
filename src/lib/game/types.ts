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

export type Shard = {
  id: number;
  x: number;
  y: number;
  /** The Megapot normal-ball value this Shard carries. */
  number: number;
  /** Score Traps carry a number the player is likely to already hold. */
  isTrap: boolean;
};

export type OrbSpawn = {
  /** Track position where the Golden Orb appears. */
  x: number;
  y: number;
  /** Seconds into the race before it lights up. */
  activateAt: number;
  /** The Megapot bonusball this orb carries. */
  bonusball: number;
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
  shards: Shard[];
  /** Checkpoint y-positions where steals are allowed. */
  stealZones: number[];
  orb: OrbSpawn | null;
  /** Ball ranges this track was generated against — stamped for later validation. */
  ballMax: number;
  bonusballMax: number;
};

/** One tick of player intent. Lateral axis in [-1, 1]; boost is a one-shot. */
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
  /** Ticks remaining of the stun/slow applied by a hard hit. */
  stunTicks: number;
  hardHits: number;
  softHits: number;
  collectedShardIds: number[];
  /** Shard numbers in pickup order — becomes the ticket's normals. */
  collectedNumbers: number[];
  hasOrb: boolean;
  bonusball: number | null;
  nearMisses: number;
  /** Steal events this racer landed. */
  steals: number;
  /** Points taken from this racer by others. */
  stolenFrom: number;
  boostsLeft: number;
  /** Checkpoints already used for a steal, so each fires at most once. */
  stealZonesUsed: number[];
};

export type RaceResultRacer = {
  id: string;
  name: string;
  isBot: boolean;
  placement: number;
  finishTick: number | null;
  hardHits: number;
  cleanRun: boolean;
  shardsCollected: number;
  collectedNumbers: number[];
  hasOrb: boolean;
  bonusball: number | null;
  nearMisses: number;
  steals: number;
  stolenFrom: number;
};

export type RaceOutcome = {
  seed: number;
  ticks: number;
  racers: RaceResultRacer[];
};
