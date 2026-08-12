/**
 * Track generation.
 *
 * One seed in, one identical track out — on every client, every time. The server
 * issues the seed; nothing about the track itself is transmitted.
 */

import {
  TRACK_WIDTH,
  CELL_VALUE,
  TRAP_COST,
  FUEL_CAN_VALUE,
  type Pickup,
  type Track,
  type OrbSpawn,
} from './types';
import { SECTION_TEMPLATES, buildSection } from './sections';
import { makeRng, randInt, randRange, shuffle, subSeed } from './rng';

export const SECTIONS_MIN = 5;
export const SECTIONS_MAX = 6;

export const CELLS_MIN = 7;
export const CELLS_MAX = 10;

/**
 * Fuel is deliberately abundant.
 *
 * Boost is the answer to a bad hit, so the answer has to be reachable — if fuel
 * were scarce, a racer who got clipped early would spend the rest of the track
 * unable to do anything about it, which is the exact failure this system exists
 * to fix. Cans are spread one per slice of the track so there is always one
 * within a few seconds' reach; being able to *route* to them is the skill.
 */
export const FUEL_CANS_MIN = 13;
export const FUEL_CANS_MAX = 18;

/** Traps look like point cells and cost points. At most a couple per race. */
export const TRAPS_MIN = 0;
export const TRAPS_MAX = 2;

/** Fraction of races that spawn a Jackpot Orb. */
export const ORB_SPAWN_CHANCE = 0.4;
/** Lead-in and run-out so racers aren't hit at the spawn line or the tape. */
export const START_PAD = 700;
export const END_PAD = 500;

/** Keep pickups off the extreme edges so they're always reachable. */
const EDGE_MARGIN = 150;

export type GenerateTrackOpts = {
  seed: number;
  /** Force orb presence (used by tests and the tutorial race). */
  forceOrb?: boolean;
};

export function generateTrack({ seed, forceOrb }: GenerateTrackOpts): Track {
  const rng = makeRng(seed);
  let idCounter = 0;
  const nextId = () => idCounter++;

  // Sections: sampled without replacement so no template repeats within a race.
  const sectionCount = randInt(rng, SECTIONS_MIN, SECTIONS_MAX);
  const chosen = shuffle(rng, SECTION_TEMPLATES).slice(0, sectionCount);

  let y = START_PAD;
  const sections = chosen.map((tpl) => {
    const s = buildSection(tpl, rng, y, nextId);
    y += s.length;
    return s;
  });

  const length = y + END_PAD;
  const obstacles = sections.flatMap((s) => s.obstacles);

  // Steal Zones sit on section boundaries — visible, readable overtake points.
  const stealZones = sections.slice(1).map((s) => s.startY);

  const pickups = placePickups(subSeed(seed, 101), sections, length);
  const orb = placeOrb(subSeed(seed, 202), sections, length, forceOrb);

  return { seed, length, sections, obstacles, pickups, stealZones, orb };
}

/**
 * Scatter the three pickup types down the track.
 *
 * Point cells and traps are placed within sections (where the obstacles are, so
 * grabbing them means threading something). Fuel cans are placed on an even
 * ladder from the first section to the run-out, so the comeback option is always
 * somewhere ahead of you rather than clustered by luck.
 */
function placePickups(
  seed: number,
  sections: Track['sections'],
  length: number,
): Pickup[] {
  const rng = makeRng(seed);
  let id = 0;
  const pickups: Pickup[] = [];

  const bodyStart = sections[0].startY;
  const bodyEnd = sections[sections.length - 1].startY + sections[sections.length - 1].length;
  const randX = () => randRange(rng, EDGE_MARGIN, TRACK_WIDTH - EDGE_MARGIN);

  // ── Point cells ─────────────────────────────────────────────────────────
  const cellCount = randInt(rng, CELLS_MIN, CELLS_MAX);
  for (let i = 0; i < cellCount; i++) {
    const section = sections[Math.min(sections.length - 1, Math.floor((i / cellCount) * sections.length))];
    pickups.push({
      id: id++,
      kind: 'cell',
      x: randX(),
      y: section.startY + section.length * randRange(rng, 0.15, 0.85),
      value: CELL_VALUE,
    });
  }

  // ── Traps ───────────────────────────────────────────────────────────────
  const trapCount = randInt(rng, TRAPS_MIN, TRAPS_MAX);
  for (let i = 0; i < trapCount; i++) {
    const section = sections[randInt(rng, 0, sections.length - 1)];
    pickups.push({
      id: id++,
      kind: 'trap',
      x: randX(),
      y: section.startY + section.length * randRange(rng, 0.2, 0.8),
      value: TRAP_COST,
    });
  }

  // ── Fuel cans ───────────────────────────────────────────────────────────
  // One per even slice of the racing body, jittered inside its own slice so the
  // spacing stays varied without ever leaving a long dry stretch.
  const canCount = randInt(rng, FUEL_CANS_MIN, FUEL_CANS_MAX);
  const slice = (bodyEnd - bodyStart) / canCount;
  for (let i = 0; i < canCount; i++) {
    // Jitter is kept inside the middle half of each slice. At the full 0.15–0.85
    // range two neighbours could land 1.7 slices apart, which on a ~9,800-unit
    // track opened 15-second stretches with no fuel in them — long enough that a
    // player who spent their tank had no way back into the race.
    pickups.push({
      id: id++,
      kind: 'fuel',
      x: randX(),
      y: Math.min(length - 120, bodyStart + slice * (i + randRange(rng, 0.25, 0.75))),
      value: FUEL_CAN_VALUE,
    });
  }

  return pickups.sort((a, b) => a.y - b.y);
}

/** The Jackpot Orb: random section, random moment, one claimant, big points. */
function placeOrb(
  seed: number,
  sections: Track['sections'],
  length: number,
  force?: boolean,
): OrbSpawn | null {
  const rng = makeRng(seed);
  if (!force && rng() > ORB_SPAWN_CHANCE) return null;

  // Never in the first section — players need time to see the alert and react.
  const idx = randInt(rng, Math.min(1, sections.length - 1), sections.length - 1);
  const section = sections[idx];
  const y = section.startY + section.length * randRange(rng, 0.2, 0.8);

  return {
    x: randRange(rng, 120, TRACK_WIDTH - 120),
    y,
    // Roughly proportional to how far down the track it sits.
    activateAt: (y / length) * randRange(rng, 30, 45),
  };
}

/** Lateral centre of an oscillating obstacle at time t (seconds). */
export function obstacleX(o: { x: number; amp: number; speed: number; phase: number }, t: number) {
  return o.x + o.amp * Math.sin(t * o.speed + o.phase);
}

/**
 * Whether a duty-cycled hazard (spike / collapsing platform) is dangerous right now.
 * Obstacles without a duty are always active.
 */
export function obstacleActive(
  o: { speed: number; phase: number; duty?: number },
  t: number,
): boolean {
  if (o.duty === undefined) return true;
  const period = (Math.PI * 2) / Math.abs(o.speed || 1);
  const cyclePos = (((t + o.phase) % period) + period) % period / period;
  return cyclePos < o.duty;
}
