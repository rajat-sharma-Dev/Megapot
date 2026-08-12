/**
 * Section templates.
 *
 * Each template emits obstacles for a stretch of track. Every instance re-rolls
 * its own parameters within tested min/max bounds, so the same template plays
 * differently every time it appears — that, not shuffling order, is what makes
 * the track unmemorisable.
 */

import { TRACK_WIDTH, type Obstacle, type SectionInstance } from './types';
import { randInt, randRange, type Rng } from './rng';

export type SectionTemplate = {
  id: string;
  name: string;
  /** What the section tests — surfaced in the HUD as a section banner. */
  tests: string;
  minLength: number;
  maxLength: number;
  build: (ctx: BuildCtx) => Obstacle[];
};

export type BuildCtx = {
  rng: Rng;
  startY: number;
  length: number;
  /** Monotonic obstacle id allocator. */
  nextId: () => number;
};

const MID = TRACK_WIDTH / 2;

export const SECTION_TEMPLATES: SectionTemplate[] = [
  {
    id: 'zigzag_blade',
    name: 'Zigzag Blade Corridor',
    tests: 'Timing & reflexes',
    minLength: 1400,
    maxLength: 1900,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const count = randInt(rng, 3, 5);
      const gap = length / (count + 1);
      const speed = randRange(rng, 1.1, 2.2);
      const amp = randRange(rng, 200, 340);
      for (let i = 0; i < count; i++) {
        out.push({
          id: nextId(),
          kind: 'blade',
          barrier: 'hard',
          y: startY + gap * (i + 1),
          x: MID,
          halfW: randRange(rng, 90, 140),
          halfH: 18,
          amp,
          speed,
          phase: (i % 2 === 0 ? 0 : Math.PI) + randRange(rng, -0.4, 0.4),
        });
      }
      return out;
    },
  },
  {
    id: 'rotating_gate',
    name: 'Rotating Gate Maze',
    tests: 'Pattern reading',
    minLength: 1500,
    maxLength: 2000,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const count = randInt(rng, 3, 4);
      const gap = length / (count + 1);
      const speed = randRange(rng, 0.6, 1.3);
      for (let i = 0; i < count; i++) {
        out.push({
          id: nextId(),
          kind: 'gate',
          barrier: 'hard',
          y: startY + gap * (i + 1),
          x: MID,
          halfW: TRACK_WIDTH / 2,
          halfH: 22,
          amp: randRange(rng, 220, 330),
          speed,
          phase: randRange(rng, 0, Math.PI * 2),
          gapHalf: randRange(rng, 120, 165),
        });
      }
      return out;
    },
  },
  {
    id: 'collapsing_bridge',
    name: 'Collapsing Platform Bridge',
    tests: 'Speed under pressure',
    minLength: 1300,
    maxLength: 1800,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const rows = randInt(rng, 5, 7);
      const gap = length / (rows + 1);
      const speed = randRange(rng, 1.4, 2.4);
      const duty = randRange(rng, 0.42, 0.56);
      for (let i = 0; i < rows; i++) {
        const lanes = randInt(rng, 2, 3);
        for (let l = 0; l < lanes; l++) {
          const laneW = TRACK_WIDTH / lanes;
          out.push({
            id: nextId(),
            kind: 'platform',
            barrier: 'soft',
            y: startY + gap * (i + 1),
            x: laneW * l + laneW / 2,
            halfW: laneW / 2 - 14,
            halfH: 26,
            amp: 0,
            speed,
            phase: randRange(rng, 0, Math.PI * 2),
            duty,
          });
        }
      }
      return out;
    },
  },
  {
    id: 'moving_wall',
    name: 'Moving Wall Squeeze',
    tests: 'Spatial judgment',
    minLength: 1200,
    maxLength: 1700,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const pairs = randInt(rng, 3, 5);
      const gap = length / (pairs + 1);
      const speed = randRange(rng, 0.7, 1.4);
      for (let i = 0; i < pairs; i++) {
        const y = startY + gap * (i + 1);
        const amp = randRange(rng, 130, 220);
        const w = randRange(rng, 180, 260);
        out.push({
          id: nextId(), kind: 'wall', barrier: 'soft', y,
          x: w / 2, halfW: w / 2, halfH: randRange(rng, 40, 70),
          amp, speed, phase: 0,
        });
        out.push({
          id: nextId(), kind: 'wall', barrier: 'soft', y,
          x: TRACK_WIDTH - w / 2, halfW: w / 2, halfH: randRange(rng, 40, 70),
          amp, speed, phase: Math.PI,
        });
      }
      return out;
    },
  },
  {
    id: 'spike_sprint',
    name: 'Spike Floor Sprint',
    tests: 'Risk vs. caution',
    minLength: 1400,
    maxLength: 1900,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const rows = randInt(rng, 2, 4);
      const gap = length / (rows + 1);
      const speed = randRange(rng, 1.8, 3.0);
      const duty = randRange(rng, 0.26, 0.38);
      for (let i = 0; i < rows; i++) {
        const cols = randInt(rng, 2, 3);
        for (let c = 0; c < cols; c++) {
          const colW = TRACK_WIDTH / cols;
          out.push({
            id: nextId(),
            kind: 'spike',
            barrier: 'hard',
            y: startY + gap * (i + 1),
            x: colW * c + colW / 2,
            // A spike's effective hit zone is halfW + PLAYER_RADIUS. Sizing this
            // as colW/2 - PLAYER_RADIUS made adjacent columns' hit zones tile the
            // track edge-to-edge, leaving no gap to run through — an active row
            // was unavoidable no matter how well it was played. The inset must
            // exceed PLAYER_RADIUS by enough to leave a real lane.
            halfW: Math.max(30, colW / 2 - 70),
            halfH: 22,
            amp: 0,
            speed,
            phase: (i * 0.7 + c * 1.1) % (Math.PI * 2),
            duty,
          });
        }
      }
      return out;
    },
  },
  {
    id: 'pendulum_hall',
    name: 'Pendulum Hall',
    tests: 'Rhythm',
    minLength: 1300,
    maxLength: 1700,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const count = randInt(rng, 2, 4);
      const gap = length / (count + 1);
      for (let i = 0; i < count; i++) {
        out.push({
          id: nextId(),
          kind: 'blade',
          barrier: 'hard',
          y: startY + gap * (i + 1),
          x: MID,
          halfW: randRange(rng, 60, 100),
          halfH: 34,
          amp: randRange(rng, 280, 400),
          speed: randRange(rng, 0.9, 1.6) * (i % 2 ? -1 : 1),
          phase: randRange(rng, 0, Math.PI * 2),
        });
      }
      return out;
    },
  },
  {
    id: 'narrow_causeway',
    name: 'Narrow Causeway',
    tests: 'Precision',
    minLength: 1100,
    maxLength: 1500,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const rows = randInt(rng, 8, 12);
      const gap = length / (rows + 1);
      const drift = randRange(rng, 90, 170);
      const speed = randRange(rng, 0.4, 0.9);
      const corridorHalf = randRange(rng, 120, 170);
      for (let i = 0; i < rows; i++) {
        const y = startY + gap * (i + 1);
        const edge = (TRACK_WIDTH / 2 - corridorHalf) / 2;
        out.push({
          id: nextId(), kind: 'wall', barrier: 'soft', y,
          x: edge, halfW: edge, halfH: gap / 2,
          amp: drift, speed, phase: 0,
        });
        out.push({
          id: nextId(), kind: 'wall', barrier: 'soft', y,
          x: TRACK_WIDTH - edge, halfW: edge, halfH: gap / 2,
          amp: drift, speed, phase: 0,
        });
      }
      return out;
    },
  },
  {
    id: 'crossfire',
    name: 'Crossfire Junction',
    tests: 'Reading two threats',
    minLength: 1400,
    maxLength: 1800,
    build: ({ rng, startY, length, nextId }) => {
      const out: Obstacle[] = [];
      const count = randInt(rng, 3, 5);
      const gap = length / (count + 1);
      const fast = randRange(rng, 1.6, 2.6);
      const slow = randRange(rng, 0.5, 1.0);
      for (let i = 0; i < count; i++) {
        const y = startY + gap * (i + 1);
        out.push({
          id: nextId(), kind: 'blade', barrier: 'hard', y,
          x: MID, halfW: randRange(rng, 70, 110), halfH: 16,
          amp: randRange(rng, 240, 360), speed: fast, phase: randRange(rng, 0, 6.28),
        });
        if (i % 2 === 0) {
          out.push({
            id: nextId(), kind: 'wall', barrier: 'soft', y: y + gap * 0.4,
            x: MID, halfW: randRange(rng, 140, 200), halfH: 30,
            amp: randRange(rng, 150, 240), speed: slow, phase: randRange(rng, 0, 6.28),
          });
        }
      }
      return out;
    },
  },
];

/**
 * Fastest lateral speed any obstacle may reach, in track units per second.
 *
 * An oscillating obstacle's peak lateral speed is `amp * |speed|`. If that
 * exceeds the player's own lateral speed (LATERAL_SPEED = 300), the obstacle can
 * out-run a player who is already reacting correctly — the hit becomes
 * unavoidable rather than a mistake. Templates roll amp and speed independently,
 * so the product has to be clamped centrally or some rolls produce hazards no
 * skill can dodge.
 *
 * Held well below 300 so there is real margin to react, not just to survive.
 */
export const MAX_OBSTACLE_LATERAL_SPEED = 205;

/** Scale down amplitude until an obstacle is dodgeable. Never touches speed. */
function enforceDodgeable(obstacles: Obstacle[]): Obstacle[] {
  for (const o of obstacles) {
    const peak = Math.abs(o.amp * o.speed);
    if (peak > MAX_OBSTACLE_LATERAL_SPEED) {
      o.amp = MAX_OBSTACLE_LATERAL_SPEED / Math.abs(o.speed || 1);
    }
  }
  return obstacles;
}

export function buildSection(
  template: SectionTemplate,
  rng: Rng,
  startY: number,
  nextId: () => number,
): SectionInstance {
  const length = randRange(rng, template.minLength, template.maxLength);
  const obstacles = enforceDodgeable(template.build({ rng, startY, length, nextId }));
  return { templateId: template.id, name: template.name, startY, length, obstacles };
}
