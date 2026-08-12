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
import { createRaceState, step, raceComplete, finalize, retire, MAX_TICKS } from './engine';
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
 * Compact input log.
 *
 * `lateral` is one entry per tick, quantised to 2dp so the JSON stays small and
 * the replay stays exact. Boost is now a held control rather than a pair of
 * one-shots, so it is run-length encoded as [startTick, lengthTicks] pairs —
 * a player holding boost for two seconds costs one pair, not 120 entries.
 */
export type InputLog = {
  lateral: number[];
  boostRuns: Array<[number, number]>;
  /** Tick at which the player bailed out, or null if they played it out. */
  quitTick: number | null;
};

export const emptyInputLog = (): InputLog => ({ lateral: [], boostRuns: [], quitTick: null });

/**
 * Expand the run-length boost encoding into a per-tick lookup.
 *
 * Defensive on purpose: this parses attacker-controlled JSON on the server, so
 * every pair is clamped into range and anything malformed is dropped rather than
 * trusted. A bogus run can waste a little memory at worst, never index wildly.
 */
export function expandBoostRuns(runs: InputLog['boostRuns'], maxTicks = MAX_TICKS): Uint8Array {
  const held = new Uint8Array(maxTicks);
  if (!Array.isArray(runs)) return held;

  for (const run of runs) {
    if (!Array.isArray(run) || run.length < 2) continue;
    const [rawStart, rawLen] = run;
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawLen)) continue;

    const start = Math.max(0, Math.min(maxTicks - 1, Math.floor(rawStart)));
    const len = Math.max(0, Math.min(maxTicks - start, Math.floor(rawLen)));
    held.fill(1, start, start + len);
  }
  return held;
}

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

export function buildTrackForRace(seed: number): Track {
  return generateTrack({ seed });
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
  inputs: InputLog;
}): { outcome: RaceOutcome; track: Track } {
  const track = buildTrackForRace(opts.seed);
  const slots = buildRacerSlots(opts.raceId, opts.humanName);
  const state = createRaceState(track, slots.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })));

  const controllers = new Map<string, BotController>();
  for (const s of slots) {
    if (s.isBot) controllers.set(s.id, new BotController(s.botSeed ?? 1, s.skill ?? 'steady'));
  }

  const boostHeld = expandBoostRuns(opts.inputs.boostRuns);
  const quitTick =
    opts.inputs.quitTick !== null && Number.isFinite(opts.inputs.quitTick)
      ? Math.max(0, Math.floor(opts.inputs.quitTick as number))
      : null;

  const inputs = new Map<string, Input>();

  while (!raceComplete(state) && state.tick < MAX_TICKS) {
    // A quit is applied before the tick it was recorded on, so the racer stops
    // exactly where the player saw them stop.
    if (quitTick !== null && state.tick >= quitTick) retire(state, HUMAN_ID);
    if (raceComplete(state)) break;

    inputs.clear();

    const lateral = opts.inputs.lateral[state.tick] ?? 0;
    inputs.set(HUMAN_ID, { lateral, boost: boostHeld[state.tick] === 1 });

    for (const s of slots) {
      if (!s.isBot) continue;
      const racer = state.racers.find((r) => r.id === s.id)!;
      if (racer.finished || racer.retired) {
        inputs.set(s.id, { lateral: 0, boost: false });
        continue;
      }
      inputs.set(
        s.id,
        controllers.get(s.id)!.decide(
          racer, track, state.tick,
          state.claimedPickups.get(s.id) ?? new Set(),
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
