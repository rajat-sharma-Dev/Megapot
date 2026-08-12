/**
 * Lobby replay — the anti-cheat spine.
 *
 * The client plays the race and records only its own inputs. The server replays
 * the whole lobby against the same seed and derives every score itself. Because
 * the engine and the bots are fully deterministic, an honest client's replay
 * reproduces exactly what it saw, and a tampered score simply doesn't reproduce.
 *
 * One authoritative simulation resolves the entire lobby, with every seat driven
 * by whatever actually drove it — a submitted input log for a human, a bot
 * controller for a house seat. That is what makes the standings on the results
 * screen the same standings the pot was paid from, rather than five independent
 * time trials stapled together.
 *
 * While a human is *playing*, they obviously can't know what the other humans
 * did, so the client stands bots in for those seats and labels them as ghost
 * lines. In the overwhelmingly common case — one human against four house
 * seats — the local race and the authoritative replay are bit-for-bit identical.
 */

import { generateTrack } from './trackgen';
import { createRaceState, step, raceComplete, finalize, retire, MAX_TICKS } from './engine';
import { BotController, BOT_NAMES, type BotSkill } from './bots';
import { makeRng, subSeed, shuffle, seedFromString } from './rng';
import type { Input, RaceOutcome, Track } from './types';

export const SEATS_PER_RACE = 5;

/**
 * Compact input log.
 *
 * `lateral` is one entry per tick, quantised to 2dp so the JSON stays small and
 * the replay stays exact. Boost is a held control rather than a pair of
 * one-shots, so it is run-length encoded as [startTick, lengthTicks] pairs — a
 * player holding boost for two seconds costs one pair, not 120 entries.
 */
export type InputLog = {
  lateral: number[];
  boostRuns: Array<[number, number]>;
  /** Tick at which the player bailed out, or null if they played it out. */
  quitTick: number | null;
};

export const emptyInputLog = (): InputLog => ({ lateral: [], boostRuns: [], quitTick: null });

/**
 * One seat in a lobby.
 *
 * `kind` is what the seat IS — a paying human or a house bot. `inputs` is what
 * the seat DID. A human seat with no inputs never drove: it staked, the deadline
 * passed, and it scores zero.
 */
export type SeatSpec = {
  index: number;
  id: string;
  name: string;
  kind: 'human' | 'bot';
  skill?: BotSkill;
  botSeed?: number;
  inputs?: InputLog | null;
  /** Display-only: a human seat the local client is standing a bot in for. */
  ghost?: boolean;
};

/**
 * The house roster for a lobby: one bot per seat index, deterministic from the
 * lobby id alone.
 *
 * Derived rather than stored so the client can render a rival's name and skill
 * without the server sending them, and so the server can rebuild an identical
 * field when it replays. Names are drawn from a shuffle rather than sampled
 * independently, which is what guarantees five distinct names instead of hoping
 * for them.
 */
export function botRoster(lobbyId: string): Array<Required<Pick<SeatSpec, 'id' | 'name' | 'skill' | 'botSeed'>>> {
  const base = seedFromString(lobbyId);
  const rng = makeRng(base);
  const names = shuffle(rng, [...BOT_NAMES]);
  const skills: BotSkill[] = ['rookie', 'steady', 'sharp'];

  return Array.from({ length: SEATS_PER_RACE }, (_, i) => ({
    id: `house_${i}`,
    name: names[i % names.length],
    skill: skills[Math.floor(makeRng(subSeed(base, i * 31))() * skills.length)],
    botSeed: subSeed(base, i * 7919),
  }));
}

/** Fill the seats a lobby never sold with house bots. */
export function botSeat(lobbyId: string, index: number): SeatSpec {
  const spec = botRoster(lobbyId)[index];
  return { index, kind: 'bot', ...spec };
}

/**
 * Recast a lobby for a single client's local run.
 *
 * Your own seat stays human and is driven by your keyboard. Every other seat —
 * including other paying humans — is driven by a bot, because their real inputs
 * don't exist yet. Their names are kept so the field reads correctly, and they
 * are flagged as ghosts so the HUD can say so.
 */
export function localSeats(seats: SeatSpec[], mySeatIndex: number, lobbyId: string): SeatSpec[] {
  const roster = botRoster(lobbyId);
  return seats.map((s) => {
    if (s.index === mySeatIndex) return { ...s, kind: 'human' as const };
    if (s.kind === 'bot') return s;
    const stand = roster[s.index];
    return {
      ...s,
      kind: 'bot' as const,
      ghost: true,
      skill: s.skill ?? stand.skill,
      botSeed: s.botSeed ?? stand.botSeed,
    };
  });
}

export function buildTrackForRace(seed: number): Track {
  return generateTrack({ seed });
}

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

/** Everything needed to drive one seat for a whole race. */
type Driver =
  | { kind: 'bot'; controller: BotController }
  | { kind: 'human'; lateral: number[]; boost: Uint8Array; quitTick: number | null }
  | { kind: 'absent' };

function buildDriver(seat: SeatSpec): Driver {
  if (seat.kind === 'bot') {
    return {
      kind: 'bot',
      controller: new BotController(seat.botSeed ?? 1, seat.skill ?? 'steady'),
    };
  }
  if (!seat.inputs) return { kind: 'absent' };

  const raw = seat.inputs;
  return {
    kind: 'human',
    lateral: (Array.isArray(raw.lateral) ? raw.lateral : []).map((v) =>
      typeof v === 'number' && Number.isFinite(v) ? v : 0,
    ),
    boost: expandBoostRuns(raw.boostRuns),
    quitTick:
      typeof raw.quitTick === 'number' && Number.isFinite(raw.quitTick)
        ? Math.max(0, Math.floor(raw.quitTick))
        : null,
  };
}

/**
 * Run a whole lobby headlessly and return the authoritative outcome.
 *
 * A seat that never submitted a run is retired on tick 0 — it staked and did not
 * drive, which is a zero, not an absence from the field. It still occupies a
 * lane, because removing it would change the track dynamics for everyone else
 * and make the result depend on who happened to time out.
 */
export function simulateLobby(opts: { seed: number; seats: SeatSpec[] }): {
  outcome: RaceOutcome;
  track: Track;
} {
  const track = buildTrackForRace(opts.seed);
  const seats = [...opts.seats].sort((a, b) => a.index - b.index);

  const state = createRaceState(
    track,
    seats.map((s) => ({ id: s.id, name: s.name, isBot: s.kind === 'bot' })),
  );

  const drivers = new Map(seats.map((s) => [s.id, buildDriver(s)]));

  // A seat with no run at all never leaves the line.
  for (const s of seats) {
    if (drivers.get(s.id)?.kind === 'absent') retire(state, s.id);
  }

  const inputs = new Map<string, Input>();

  while (!raceComplete(state) && state.tick < MAX_TICKS) {
    // A quit is applied before the tick it was recorded on, so the racer stops
    // exactly where the player saw them stop.
    for (const s of seats) {
      const d = drivers.get(s.id);
      if (d?.kind === 'human' && d.quitTick !== null && state.tick >= d.quitTick) {
        retire(state, s.id);
      }
    }
    if (raceComplete(state)) break;

    inputs.clear();

    for (const s of seats) {
      const racer = state.racers.find((r) => r.id === s.id)!;
      if (racer.finished || racer.retired) {
        inputs.set(s.id, { lateral: 0, boost: false });
        continue;
      }

      const d = drivers.get(s.id)!;
      if (d.kind === 'human') {
        inputs.set(s.id, {
          lateral: d.lateral[state.tick] ?? 0,
          boost: d.boost[state.tick] === 1,
        });
      } else if (d.kind === 'bot') {
        inputs.set(
          s.id,
          d.controller.decide(
            racer,
            track,
            state.tick,
            state.claimedPickups.get(s.id) ?? new Set(),
            state.orbClaimedBy !== null,
          ),
        );
      } else {
        inputs.set(s.id, { lateral: 0, boost: false });
      }
    }

    step(state, inputs);
  }

  return { outcome: finalize(state), track };
}

/** Quantise so the client's recorded log and the server's replay agree bit-for-bit. */
export const quantiseLateral = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 100) / 100;
