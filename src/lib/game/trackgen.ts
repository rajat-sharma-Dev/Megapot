/**
 * Track generation.
 *
 * One seed in, one identical track out — on every client, every time. The server
 * issues the seed; nothing about the track itself is transmitted.
 */

import { TRACK_WIDTH, type Shard, type Track, type OrbSpawn } from './types';
import { SECTION_TEMPLATES, buildSection } from './sections';
import { makeRng, randInt, randRange, shuffle, subSeed } from './rng';
import { generateShardNumbers, generateOrbBonusball, NORMALS_PER_TICKET } from '../megapot/numbers';

export const SECTIONS_MIN = 5;
export const SECTIONS_MAX = 6;
export const SHARDS_MIN = 6;
export const SHARDS_MAX = 8;
/** Fraction of races that spawn a Golden Orb. */
export const ORB_SPAWN_CHANCE = 0.4;
/** Lead-in and run-out so racers aren't hit at the spawn line or the tape. */
export const START_PAD = 700;
export const END_PAD = 500;

export type GenerateTrackOpts = {
  seed: number;
  /** From getDrawingState — never hardcode these. */
  ballMax: number;
  bonusballMax: number;
  /** Force orb presence (used by tests and the tutorial race). */
  forceOrb?: boolean;
};

export function generateTrack({
  seed,
  ballMax,
  bonusballMax,
  forceOrb,
}: GenerateTrackOpts): Track {
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

  const shards = placeShards(subSeed(seed, 101), sections, ballMax);
  const orb = placeOrb(subSeed(seed, 202), sections, length, bonusballMax, forceOrb);

  return { seed, length, sections, obstacles, shards, stealZones, orb, ballMax, bonusballMax };
}

/**
 * Shards carry the numbers that become the player's ticket. The set is
 * guaranteed to contain at least 5 distinct values, so a perfect run always
 * yields a fully-earned ticket.
 */
function placeShards(
  seed: number,
  sections: Track['sections'],
  ballMax: number,
): Shard[] {
  const rng = makeRng(seed);
  const count = randInt(rng, SHARDS_MIN, SHARDS_MAX);
  const numbers = generateShardNumbers(count, ballMax, rng);

  // At most one Score Trap per race: a shard duplicating a number placed earlier,
  // so grabbing it burns a pick slot rather than gaining one.
  //
  // The trap may only overwrite a number that is ALREADY duplicated elsewhere on
  // the track. Overwriting a unique value would destroy the guarantee that every
  // track offers five distinct numbers, and a player could then be denied a full
  // ticket through no fault of their own.
  let trapIndex = -1;
  if (count > NORMALS_PER_TICKET) {
    const freq = new Map<number, number>();
    for (const n of numbers) freq.set(n, (freq.get(n) ?? 0) + 1);

    const safeIndices = numbers
      .map((n, i) => ({ n, i }))
      .filter(({ n, i }) => i > 0 && (freq.get(n) ?? 0) > 1);

    if (safeIndices.length > 0) {
      trapIndex = safeIndices[randInt(rng, 0, safeIndices.length - 1)].i;
      numbers[trapIndex] = numbers[randInt(rng, 0, trapIndex - 1)];
    }
  }

  const shards: Shard[] = [];
  for (let i = 0; i < count; i++) {
    // Spread shards evenly down the track, jittered within their slice.
    const section = sections[Math.min(sections.length - 1, Math.floor((i / count) * sections.length))];
    const t = randRange(rng, 0.15, 0.85);
    shards.push({
      id: i,
      x: randRange(rng, 170, TRACK_WIDTH - 170),
      y: section.startY + section.length * t,
      number: numbers[i],
      isTrap: i === trapIndex,
    });
  }
  return shards.sort((a, b) => a.y - b.y);
}

/** The Golden Orb: random section, random moment, carries the bonusball. */
function placeOrb(
  seed: number,
  sections: Track['sections'],
  length: number,
  bonusballMax: number,
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
    bonusball: generateOrbBonusball(bonusballMax, rng),
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
