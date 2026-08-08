/**
 * Test helper: drive a race with a bot standing in for the human player, and
 * record the input log exactly as the browser would.
 *
 * This is what makes the end-to-end test real — the log it produces is the same
 * shape the client submits, so the server replays it through the identical code
 * path a genuine player would hit.
 */

import { createRaceState, step, raceComplete, finalize, MAX_TICKS } from '../../src/lib/game/engine';
import { buildTrackForRace, buildRacerSlots, HUMAN_ID, quantiseLateral, type InputLog } from '../../src/lib/game/replay';
import { BotController, type BotSkill } from '../../src/lib/game/bots';
import type { Input, RaceOutcome } from '../../src/lib/game/types';

export function driveRace(opts: {
  seed: number;
  raceId: string;
  humanName: string;
  ballMax: number;
  bonusballMax: number;
  /** How well the stand-in "player" drives. */
  humanSkill?: BotSkill;
  humanSeed?: number;
}): { inputs: InputLog; outcome: RaceOutcome } {
  const track = buildTrackForRace(opts.seed, opts.ballMax, opts.bonusballMax);
  const slots = buildRacerSlots(opts.raceId, opts.humanName);
  const state = createRaceState(track, slots.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })));

  const controllers = new Map<string, BotController>();
  for (const s of slots) {
    if (s.isBot) controllers.set(s.id, new BotController(s.botSeed ?? 1, s.skill ?? 'steady'));
  }
  const human = new BotController(opts.humanSeed ?? opts.seed ^ 0x5f3d, opts.humanSkill ?? 'sharp');

  const inputs: InputLog = { lateral: [], boostTicks: [] };
  const frame = new Map<string, Input>();

  while (!raceComplete(state) && state.tick < MAX_TICKS) {
    frame.clear();
    const me = state.racers.find((r) => r.id === HUMAN_ID)!;
    const raw = me.finished
      ? { lateral: 0, boost: false }
      : human.decide(
          me, track, state.tick,
          state.claimedShards.get(HUMAN_ID) ?? new Set(),
          state.orbClaimedBy !== null,
        );

    // Quantise before recording AND before stepping, so the log the server
    // replays is bit-identical to what drove this simulation.
    const lateral = quantiseLateral(raw.lateral);
    inputs.lateral.push(lateral);
    if (raw.boost) inputs.boostTicks.push(state.tick);
    frame.set(HUMAN_ID, { lateral, boost: raw.boost });

    for (const [id, bot] of controllers) {
      const racer = state.racers.find((r) => r.id === id)!;
      frame.set(
        id,
        racer.finished
          ? { lateral: 0, boost: false }
          : bot.decide(
              racer, track, state.tick,
              state.claimedShards.get(id) ?? new Set(),
              state.orbClaimedBy !== null,
            ),
      );
    }

    step(state, frame);
  }

  return { inputs, outcome: finalize(state) };
}
