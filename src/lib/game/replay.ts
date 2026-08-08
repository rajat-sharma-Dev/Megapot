/**
 * Race replay — the anti-cheat spine.
 *
 * The client plays the race and records only its own inputs. The server replays
 * that input log against the same seed and derives the outcome itself. Because
 * the engine and the bots are fully deterministic, an honest client's replay
 * reproduces exactly what it saw, and a tampered score simply doesn't reproduce.
 *
 * Both sides call `simulateRace`, so they can never drift apart.
 */

import { generateTrack } from './trackgen';
import { createRaceState, step, raceComplete, finalize, MAX_TICKS } from './engine';
import { BotController, BOT_NAMES, type BotSkill } from './bots';
import { makeRng, subSeed, seedFromString } from './rng';
import type { Input, RaceOutcome, Track } from './types';

export const HUMAN_ID = 'player';
export const RACERS_PER_RACE = 5;

export type RacerSlot = {
  id: string;
  name: string;
  isBot: boolean;
  skill?: BotSkill;
  botSeed?: number;
};

/**
 * Compact input log. `lateral` is one entry per tick (quantised to 2dp so the
 * JSON stays small and the replay stays exact); `boostTicks` lists the ticks a
 * boost was requested.
 */
export type InputLog = {
  lateral: number[];
  boostTicks: number[];
};

/**
 * Deterministic lobby composition. The same race id always yields the same
 * bots with the same skills, so the server rebuilds the field without the
 * client telling it anything.
 */
export function buildRacerSlots(raceId: string, humanName: string, humanCount = 1): RacerSlot[] {
  const rng = makeRng(seedFromString(raceId));
  const skills: BotSkill[] = ['rookie', 'steady', 'sharp'];
  const usedNames = new Set<string>();

  const slots: RacerSlot[] = [{ id: HUMAN_ID, name: humanName, isBot: false }];

  for (let i = humanCount; i < RACERS_PER_RACE; i++) {
    let name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
    while (usedNames.has(name)) name = BOT_NAMES[Math.floor(rng() * BOT_NAMES.length)];
    usedNames.add(name);

    slots.push({
      id: `bot_${i}`,
      name,
      isBot: true,
      skill: skills[Math.floor(rng() * skills.length)],
      botSeed: subSeed(seedFromString(raceId), i * 7919),
    });
  }
  return slots;
}

export function buildTrackForRace(seed: number, ballMax: number, bonusballMax: number): Track {
  return generateTrack({ seed, ballMax, bonusballMax });
}

/**
 * Run a full race headlessly.
 *
 * @param inputs Human input log. Ticks beyond its end coast with no steering,
 *               which is what happens if a player closes the tab mid-race.
 */
export function simulateRace(opts: {
  seed: number;
  raceId: string;
  humanName: string;
  ballMax: number;
  bonusballMax: number;
  inputs: InputLog;
}): { outcome: RaceOutcome; track: Track } {
  const track = buildTrackForRace(opts.seed, opts.ballMax, opts.bonusballMax);
  const slots = buildRacerSlots(opts.raceId, opts.humanName);
  const state = createRaceState(track, slots.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })));

  const controllers = new Map<string, BotController>();
  for (const s of slots) {
    if (s.isBot) controllers.set(s.id, new BotController(s.botSeed ?? 1, s.skill ?? 'steady'));
  }

  const boostSet = new Set(opts.inputs.boostTicks);
  const inputs = new Map<string, Input>();

  while (!raceComplete(state) && state.tick < MAX_TICKS) {
    inputs.clear();

    const lateral = opts.inputs.lateral[state.tick] ?? 0;
    inputs.set(HUMAN_ID, { lateral, boost: boostSet.has(state.tick) });

    for (const s of slots) {
      if (!s.isBot) continue;
      const racer = state.racers.find((r) => r.id === s.id)!;
      if (racer.finished) {
        inputs.set(s.id, { lateral: 0, boost: false });
        continue;
      }
      inputs.set(
        s.id,
        controllers.get(s.id)!.decide(
          racer, track, state.tick,
          state.claimedShards.get(s.id) ?? new Set(),
          state.orbClaimedBy !== null,
        ),
      );
    }

    step(state, inputs);
  }

  return { outcome: finalize(state), track };
}

/** Quantise so the client's recorded log and the server's replay agree bit-for-bit. */
export const quantiseLateral = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
