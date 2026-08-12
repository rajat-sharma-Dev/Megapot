/**
 * Test helper: drive a lobby seat with a bot standing in for the human player,
 * and record the input log exactly as the browser would.
 *
 * This is what makes the end-to-end test real — the log it produces is the same
 * shape the client submits, so the server replays it through the identical code
 * path a genuine player would hit.
 */

import {
  createRaceState, step, raceComplete, finalize, retire, isOut, MAX_TICKS,
} from '../../src/lib/game/engine';
import {
  buildTrackForRace, botRoster, quantiseLateral, emptyInputLog,
  SEATS_PER_RACE, type InputLog, type SeatSpec,
} from '../../src/lib/game/replay';
import { BotController, type BotSkill } from '../../src/lib/game/bots';
import type { Input, RaceOutcome } from '../../src/lib/game/types';

/**
 * Build the field a client would simulate locally: your seat, plus house bots
 * in every other seat. Matches `localSeats` for the common one-human lobby.
 */
export function localField(lobbyId: string, mySeat: number, myName: string): SeatSpec[] {
  const roster = botRoster(lobbyId);
  return Array.from({ length: SEATS_PER_RACE }, (_, i) =>
    i === mySeat
      ? { index: i, id: `seat_${i}`, name: myName, kind: 'human' as const }
      : { index: i, kind: 'bot' as const, ...roster[i] },
  );
}

export function driveRace(opts: {
  seed: number;
  lobbyId: string;
  humanName: string;
  /** Seat the stand-in player occupies. */
  mySeat?: number;
  /** How well the stand-in "player" drives. */
  humanSkill?: BotSkill;
  humanSeed?: number;
  /**
   * Quit once this fraction of the track is covered, mirroring a player hitting
   * the Quit button mid-race. Omitted means play it out.
   */
  quitAtProgress?: number;
}): { inputs: InputLog; outcome: RaceOutcome; myId: string } {
  const mySeat = opts.mySeat ?? 0;
  const track = buildTrackForRace(opts.seed);
  const seats = localField(opts.lobbyId, mySeat, opts.humanName);
  const myId = seats[mySeat].id;

  const state = createRaceState(
    track,
    seats.map((s) => ({ id: s.id, name: s.name, isBot: s.kind === 'bot' })),
  );

  const controllers = new Map<string, BotController>();
  for (const s of seats) {
    if (s.kind === 'bot') controllers.set(s.id, new BotController(s.botSeed ?? 1, s.skill ?? 'steady'));
  }
  const human = new BotController(opts.humanSeed ?? opts.seed ^ 0x5f3d, opts.humanSkill ?? 'sharp');

  const inputs = emptyInputLog();
  const frame = new Map<string, Input>();
  let openRun: { start: number; len: number } | null = null;
  let quitTick: number | null = null;

  while (!raceComplete(state) && state.tick < MAX_TICKS) {
    const me = state.racers.find((r) => r.id === myId)!;

    // Decide to bail out. Recorded as the tick the quit takes effect, and applied
    // at the top of that tick — the same ordering the server replay uses.
    if (
      opts.quitAtProgress !== undefined &&
      quitTick === null &&
      !isOut(me) &&
      me.y / track.length >= opts.quitAtProgress
    ) {
      quitTick = state.tick;
    }
    if (quitTick !== null && state.tick >= quitTick) retire(state, myId);
    if (raceComplete(state)) break;

    frame.clear();

    const humanOut = isOut(me);
    const raw = humanOut
      ? { lateral: 0, boost: false }
      : human.decide(
          me, track, state.tick,
          state.claimedPickups.get(myId) ?? new Set(),
          state.orbClaimedBy !== null,
        );

    // Quantise before recording AND before stepping, so the log the server
    // replays is bit-identical to what drove this simulation.
    const lateral = quantiseLateral(raw.lateral);

    if (!humanOut) {
      inputs.lateral.push(lateral);

      // Run-length encode the boost hold, exactly as the client does.
      if (raw.boost) {
        if (openRun && openRun.start + openRun.len === state.tick) openRun.len++;
        else {
          if (openRun) inputs.boostRuns.push([openRun.start, openRun.len]);
          openRun = { start: state.tick, len: 1 };
        }
      } else if (openRun) {
        inputs.boostRuns.push([openRun.start, openRun.len]);
        openRun = null;
      }
    }

    frame.set(myId, { lateral, boost: raw.boost });

    for (const [id, bot] of controllers) {
      const racer = state.racers.find((r) => r.id === id)!;
      frame.set(
        id,
        isOut(racer)
          ? { lateral: 0, boost: false }
          : bot.decide(
              racer, track, state.tick,
              state.claimedPickups.get(id) ?? new Set(),
              state.orbClaimedBy !== null,
            ),
      );
    }

    step(state, frame);
  }

  if (openRun) inputs.boostRuns.push([openRun.start, openRun.len]);
  inputs.quitTick = quitTick;

  return { inputs, outcome: finalize(state), myId };
}
