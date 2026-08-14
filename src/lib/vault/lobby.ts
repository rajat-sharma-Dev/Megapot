/**
 * The lobby — matchmaking, settlement, and the moment value changes hands.
 *
 * The whole loop in one paragraph: five seats, each staking a fifth of a Megapot
 * ticket. Empty seats are taken by the house, which stakes from its own float
 * and plays to keep it. Everyone drives the same track. The highest total score
 * takes the entire pot — not the racer who crossed the line first, the racer who
 * *scored* most, which is a different question and usually a different answer.
 * The pot buys a real Megapot ticket outright, minted straight to the winner's
 * wallet; anything too small to buy one is refunded to their balance.
 *
 * Two things about this file are load bearing:
 *
 *  · Everything is server-side and everything is derived. A client submits an
 *    input log and nothing else. Scores come from a replay this module runs.
 *  · There is no scheduler. Lobbies lock and settle lazily, driven by whoever
 *    next touches them, so the app is correct on a platform with no cron.
 */

import 'server-only';
import { randomBytes } from 'crypto';
import {
  getOrCreatePlayer, updatePlayer, adjustBalance, getHouseFloat, adjustHouseFloat,
  createLobby, getLobby, findJoinableLobby, listPendingLobbies, save,
  getOrbRollover, bumpOrbRollover, recordTicket, toUnits, normalizeAddress,
  type Lobby, type SeatRecord, type Player, type StandingRow,
} from '../db/store';
import { simulateLobby, botRoster, type InputLog, type SeatSpec } from '../game/replay';
import { scoreRace } from '../points/scoring';
import { resolvePot, refundSeats, type PotSeat } from './pot';
import { SEATS_PER_RACE, entryFeeUnits, potToTickets } from './economy';
import { getCurrentDrawing } from '../megapot/drawing';
import { buyTicketsFor, SettlementInProgressError } from '../megapot/purchase';
import { NETWORK } from '../megapot/addresses';

/**
 * How long an under-filled lobby waits for more humans before the house takes
 * the empty seats.
 *
 * Short on purpose. A player who clicked "race" wants to race; fifteen seconds
 * of a filling lobby reads as anticipation, and forty reads as a broken queue.
 */
export const FILL_WINDOW_MS = Number(process.env.RALLY_FILL_WINDOW_MS ?? 15_000);

/**
 * How long a locked lobby waits for every human to actually drive before it
 * settles without them. A seat that never drives scores zero and forfeits its
 * stake to the pot — which is the only thing that stops one player wandering off
 * from holding four other people's money hostage.
 */
export const SUBMIT_WINDOW_MS = Number(process.env.RALLY_SUBMIT_WINDOW_MS ?? 5 * 60_000);

/**
 * Whether house seats stake.
 *
 * On by default, and it is what makes a solo race a real race: the house puts an
 * entry fee on each of its seats and keeps the whole pot when one of its racers
 * outscores you. It is a bankroll, not a subsidy — the float goes up as often as
 * it goes down, and when it is empty the house seats race for nothing and the
 * pot is only what the humans put in.
 */
const HOUSE_STAKES = process.env.RALLY_HOUSE_STAKE !== 'false';

export class InsufficientFundsError extends Error {
  constructor(public needUnits: bigint, public haveUnits: bigint) {
    super(
      `Not enough balance to enter: need ${needUnits} base units, have ${haveUnits}. ` +
        `Deposit USDC from your wallet to keep racing.`,
    );
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Serialise every lobby mutation.
 *
 * Seat assignment is a read-modify-write across several awaits, and two players
 * hitting "race" in the same tick would otherwise both read the same empty seat
 * and both take it. Node is single-threaded, so a promise chain is a real lock
 * here — and this store is single-process by design anyway.
 */
const g = globalThis as unknown as { __rallyLobbyLock?: Promise<unknown> };
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = (g.__rallyLobbyLock ?? Promise.resolve()).then(fn, fn);
  g.__rallyLobbyLock = next.catch(() => {});
  return next;
}

const emptySeat = (index: number): SeatRecord => ({
  index,
  kind: 'empty',
  id: '',
  name: '',
  staked: false,
  joinedAt: null,
  submittedAt: null,
  inputs: null,
  points: null,
  placement: null,
  retired: null,
  breakdown: null,
});

// ─── Joining ────────────────────────────────────────────────────────────────

export type JoinResult = {
  lobby: Lobby;
  seatIndex: number;
  entryFeeUnits: bigint;
  creditsAfter: bigint;
};

/**
 * Take a seat in a lobby, paying the entry fee.
 *
 * Matchmaking is deliberately dumb and deliberately fast: join the oldest open
 * lobby that still has a seat, otherwise open one. Nobody is rated and nobody is
 * bracketed — the field is random, which is the point.
 */
export async function joinLobby(address: string, name?: string): Promise<JoinResult> {
  return withLock(async () => {
    await advanceLobbies();

    const drawing = await getCurrentDrawing();
    const feeUnits = entryFeeUnits(drawing.ticketPrice);
    if (feeUnits <= 0n) {
      throw new Error('Live ticket price is zero — refusing to open a race with no stake.');
    }

    const player = await getOrCreatePlayer(address, name);
    const have = toUnits(player.creditsUnits);
    if (have < feeUnits) throw new InsufficientFundsError(feeUnits, have);

    const nowMs = Date.now();
    let lobby = await findJoinableLobby(nowMs);

    // Never seat the same wallet twice in one lobby: you would be staking
    // against yourself and the pot would be meaningless.
    if (lobby && lobby.seats.some((s) => s.id === normalizeAddress(address))) lobby = null;

    if (!lobby) {
      lobby = await createLobby({
        id: randomBytes(12).toString('hex'),
        seed: randomBytes(4).readUInt32BE(0),
        state: 'open',
        createdAt: new Date(nowMs).toISOString(),
        fillDeadline: new Date(nowMs + FILL_WINDOW_MS).toISOString(),
        submitDeadline: null,
        entryFeeUnits: feeUnits.toString(),
        ticketPriceUnits: drawing.ticketPrice.toString(),
        drawingId: drawing.drawingId.toString(),
        rolloverCount: await getOrbRollover(),
        seats: Array.from({ length: SEATS_PER_RACE }, (_, i) => emptySeat(i)),
        settlement: null,
      });
    }

    const seat = lobby.seats.find((s) => s.kind === 'empty');
    if (!seat) throw new Error('That lobby filled up — try again.');

    // The fee is charged against the lobby's fee, not today's, so a player who
    // joined before a price change pays what they were quoted.
    const lobbyFee = toUnits(lobby.entryFeeUnits);
    if (have < lobbyFee) throw new InsufficientFundsError(lobbyFee, have);

    const updated = await adjustBalance({
      playerId: player.id,
      field: 'creditsUnits',
      deltaUnits: -lobbyFee,
      kind: 'entry',
      lobbyId: lobby.id,
      note: `Seat ${seat.index + 1} in lobby ${lobby.id.slice(0, 8)}`,
    });

    seat.kind = 'human';
    seat.id = player.id;
    seat.name = player.name;
    seat.staked = true;
    seat.joinedAt = new Date().toISOString();

    await updatePlayer(player.id, {
      racesPlayed: player.racesPlayed + 1,
      lifetimeWageredUnits: (toUnits(player.lifetimeWageredUnits) + lobbyFee).toString(),
    });

    // A lobby that just sold its last seat starts immediately rather than
    // sitting out the rest of its fill window.
    if (!lobby.seats.some((s) => s.kind === 'empty')) {
      await lockLobby(lobby);
    } else {
      await save();
    }

    return {
      lobby,
      seatIndex: seat.index,
      entryFeeUnits: lobbyFee,
      creditsAfter: toUnits(updated.creditsUnits),
    };
  });
}

// ─── Locking ────────────────────────────────────────────────────────────────

/**
 * Close the doors and fill what's left with house seats.
 *
 * The house stakes each of its seats from the float, and only from the float —
 * if it can't cover a seat, that seat still races but stakes nothing and cannot
 * win a pot. The alternative (minting a stake out of nowhere) would make the
 * pot bigger than the money behind it, which is exactly the thing this economy
 * is built not to do.
 */
export async function lockLobby(lobby: Lobby): Promise<Lobby> {
  if (lobby.state !== 'open') return lobby;

  const roster = botRoster(lobby.id);
  const fee = toUnits(lobby.entryFeeUnits);

  for (const seat of lobby.seats) {
    if (seat.kind !== 'empty') continue;
    const spec = roster[seat.index];

    seat.kind = 'bot';
    seat.id = spec.id;
    seat.name = spec.name;
    seat.skill = spec.skill;
    seat.botSeed = spec.botSeed;
    seat.joinedAt = new Date().toISOString();
    seat.staked = false;

    if (HOUSE_STAKES && fee > 0n) {
      const float = await getHouseFloat();
      if (float >= fee) {
        await adjustHouseFloat(-fee);
        seat.staked = true;
      }
    }
  }

  lobby.state = 'locked';
  lobby.submitDeadline = new Date(Date.now() + SUBMIT_WINDOW_MS).toISOString();
  await save();
  return lobby;
}

// ─── Submitting a run ───────────────────────────────────────────────────────

export type SubmitResult = {
  lobby: Lobby;
  seatIndex: number;
  /** True once the lobby resolved on this submission. */
  settled: boolean;
};

export async function submitRun(
  lobbyId: string,
  address: string,
  inputs: InputLog,
): Promise<SubmitResult> {
  return withLock(async () => {
    const lobby = await getLobby(lobbyId);
    if (!lobby) throw new Error(`Unknown lobby ${lobbyId}`);

    // A player who finishes before the fill window expires closes it themselves.
    if (lobby.state === 'open') await lockLobby(lobby);
    if (lobby.state === 'settled') throw new Error('This race has already been settled');

    const id = normalizeAddress(address);
    const seat = lobby.seats.find((s) => s.id === id && s.kind === 'human');
    if (!seat) throw new Error('You do not hold a seat in this race');
    if (seat.submittedAt) throw new Error('You have already submitted this race');

    seat.inputs = inputs;
    seat.submittedAt = new Date().toISOString();
    await save();

    const everyoneIn = lobby.seats
      .filter((s) => s.kind === 'human')
      .every((s) => !!s.submittedAt);

    if (everyoneIn) {
      await settleLobby(lobby);
      return { lobby, seatIndex: seat.index, settled: true };
    }

    return { lobby, seatIndex: seat.index, settled: false };
  });
}

// ─── Settlement ─────────────────────────────────────────────────────────────

/**
 * Resolve a locked lobby: run the authoritative race, name the winner, move the
 * money, and buy a ticket if the winner's vault can now afford one.
 *
 * Idempotent. Settling an already-settled lobby returns it untouched, because
 * this is reachable from three different places (a submission, a poll, and a
 * deadline sweep) and any of them can arrive second.
 */
export async function settleLobby(lobby: Lobby): Promise<Lobby> {
  if (lobby.state === 'settled') return lobby;
  if (lobby.state === 'open') await lockLobby(lobby);

  const specs: SeatSpec[] = lobby.seats.map((s) => ({
    index: s.index,
    id: s.id,
    name: s.name,
    kind: s.kind === 'bot' ? 'bot' : 'human',
    skill: s.skill,
    botSeed: s.botSeed,
    inputs: s.inputs ?? null,
  }));

  const { outcome } = simulateLobby({ seed: lobby.seed, seats: specs });
  const breakdowns = scoreRace(outcome, lobby.rolloverCount);
  const byId = new Map(breakdowns.map((b) => [b.racerId, b]));

  for (const seat of lobby.seats) {
    const b = byId.get(seat.id) ?? null;
    seat.breakdown = b;
    seat.points = b?.total ?? 0;
    seat.placement = b?.placement ?? SEATS_PER_RACE;
    seat.retired = b?.retired ?? true;
  }

  // The orb stacks whenever nobody claimed it, across lobbies.
  await bumpOrbRollover(outcome.racers.some((r) => r.hasOrb));

  const potSeats: PotSeat[] = lobby.seats.map((s) => ({
    index: s.index,
    kind: s.kind === 'bot' ? 'bot' : 'human',
    id: s.id,
    name: s.name,
    staked: s.staked,
    score: s.breakdown,
  }));

  const fee = toUnits(lobby.entryFeeUnits);
  const pot = resolvePot(potSeats, fee);
  const refunds = refundSeats(pot, potSeats);

  const standings: StandingRow[] = pot.standings.map((s) => ({
    index: s.index,
    id: s.id,
    name: s.name,
    kind: s.kind,
    points: s.score?.total ?? 0,
    placement: s.score?.placement ?? SEATS_PER_RACE,
    retired: s.score?.retired ?? true,
    progress: s.score?.progress ?? 0,
    isWinner: s.index === pot.winner?.index,
  }));

  // ── Move the money ──────────────────────────────────────────────────────
  let ticketsMinted = 0;
  let txHashes: string[] = [];
  let mintError: string | null = null;

  if (refunds.length > 0) {
    // Nobody scored a single point. Give everything back rather than handing a
    // pot to a racer who did nothing to earn it.
    for (const s of refunds) {
      if (s.kind === 'bot') {
        await adjustHouseFloat(fee);
      } else {
        await adjustBalance({
          playerId: s.id,
          field: 'creditsUnits',
          deltaUnits: fee,
          kind: 'refund',
          lobbyId: lobby.id,
          note: 'No racer scored — stake returned',
        });
      }
    }
  } else if (pot.winner && pot.winner.kind === 'bot') {
    await adjustHouseFloat(pot.potUnits);
  } else if (pot.winner) {
    const winner = await getOrCreatePlayer(pot.winner.id);

    await updatePlayer(winner.id, {
      racesWon: winner.racesWon + 1,
      lifetimeWonUnits: (toUnits(winner.lifetimeWonUnits) + pot.potUnits).toString(),
    });

    /**
     * The pot buys tickets directly.
     *
     * No intermediate balance to hold it in: the winner's stake became a
     * Megapot ticket, or — if the pot was short of a whole one because the
     * house float could not stake every seat — it goes back to their spendable
     * balance. Either way the value is somewhere they can see it immediately.
     */
    const minted = await mintFromPot(
      winner.id,
      pot.potUnits,
      toUnits(lobby.ticketPriceUnits),
      lobby.id,
    );
    ticketsMinted = minted.tickets;
    txHashes = minted.txHashes;
    mintError = minted.error;
  }

  // ── Per-player stats ────────────────────────────────────────────────────
  for (const seat of lobby.seats) {
    if (seat.kind !== 'human' || !seat.breakdown) continue;
    const p = await getOrCreatePlayer(seat.id);
    await updatePlayer(p.id, {
      lifetimePoints: p.lifetimePoints + seat.breakdown.total,
      bestRaceScore: Math.max(p.bestRaceScore, seat.breakdown.total),
      racesRetired: p.racesRetired + (seat.breakdown.retired ? 1 : 0),
      totalStolen:
        p.totalStolen + (outcome.racers.find((r) => r.id === seat.id)?.steals ?? 0),
    });
  }

  lobby.settlement = {
    settledAt: new Date().toISOString(),
    winnerSeat: pot.winner?.index ?? null,
    winnerId: pot.winner?.id ?? null,
    winnerName: pot.winner?.name ?? null,
    winnerKind: pot.winner?.kind ?? null,
    potUnits: pot.potUnits.toString(),
    stakedSeats: pot.stakedSeats,
    houseWins: pot.houseWins,
    refunded: refunds.length > 0,
    standings,
    ticketsMinted,
    txHashes,
    mintError,
  };
  lobby.state = 'settled';

  // Input logs are ~4,000 numbers each and have done their job.
  for (const seat of lobby.seats) seat.inputs = null;

  await save();
  return lobby;
}

/**
 * Turn a won pot into real Megapot tickets.
 *
 * The order here is the important part. Tickets are bought FIRST, and the
 * player's balance is only credited with what could not be spent. A failed
 * purchase therefore refunds the entire pot to their balance rather than
 * vanishing — losing somebody's winnings to a transient RPC error or an
 * unfunded treasury is not an acceptable failure mode, and it is the failure
 * mode that actually happens.
 */
export async function mintFromPot(
  playerId: string,
  potUnits: bigint,
  ticketPriceUnits: bigint,
  lobbyId: string | null,
): Promise<{ tickets: number; txHashes: string[]; error: string | null }> {
  const player = await getOrCreatePlayer(playerId);
  const { tickets, remainderUnits } = potToTickets(potUnits, ticketPriceUnits);

  /** Give back whatever tickets could not absorb. */
  const refund = async (units: bigint, note: string) => {
    if (units <= 0n) return;
    await adjustBalance({
      playerId: player.id,
      field: 'creditsUnits',
      deltaUnits: units,
      kind: 'win',
      lobbyId,
      note,
    });
  };

  if (tickets <= 0) {
    await refund(potUnits, 'Pot won — too small for a whole ticket, returned to your balance');
    return { tickets: 0, txHashes: [], error: null };
  }

  try {
    const results = await buyTicketsFor(player.id as `0x${string}`, tickets);

    for (const [i, res] of results.entries()) {
      await recordTicket({
        id: `${res.txHash}-${i}`,
        playerId: player.id,
        txHash: res.txHash,
        drawingId: res.drawingId.toString(),
        count: res.count,
        lobbyId,
        network: NETWORK,
        simulated: res.simulated,
        ticketIds: res.ticketIds,
      });
    }

    const after = await getOrCreatePlayer(player.id);
    await updatePlayer(player.id, { ticketsEarned: after.ticketsEarned + tickets });

    await refund(remainderUnits, 'Pot remainder returned to your balance');

    return { tickets, txHashes: results.map((r) => r.txHash), error: null };
  } catch (err) {
    // The purchase failed, so the winner keeps the money instead of the ticket.
    await refund(potUnits, 'Pot won — ticket purchase failed, refunded to your balance');

    return {
      tickets: 0,
      txHashes: [],
      error:
        err instanceof SettlementInProgressError
          ? 'Megapot is mid-draw, so no ticket could be bought. Your winnings are in your balance.'
          : `Ticket purchase failed (${(err as Error).message.split('\n')[0]}). Your winnings are in your balance.`,
    };
  }
}

// ─── Deadline sweeps ────────────────────────────────────────────────────────

/**
 * Advance every lobby whose deadline has passed.
 *
 * Called opportunistically from API routes rather than from a scheduler, so the
 * app is correct on a platform with no cron: whoever shows up next does the
 * work. Failures are swallowed — a stuck lobby stays stuck and gets retried on
 * the next request rather than breaking whatever the caller was actually doing.
 */
export async function advanceLobbies(): Promise<void> {
  const nowMs = Date.now();
  for (const lobby of await listPendingLobbies()) {
    try {
      if (lobby.state === 'open' && new Date(lobby.fillDeadline).getTime() <= nowMs) {
        await lockLobby(lobby);
      }
      if (
        lobby.state === 'locked' &&
        lobby.submitDeadline &&
        new Date(lobby.submitDeadline).getTime() <= nowMs
      ) {
        await settleLobby(lobby);
      }
    } catch {
      // Leave it for the next request.
    }
  }
}

/**
 * Fetch a lobby, advancing its state first if a deadline has passed.
 *
 * This is what the client polls while the matchmaking screen is up, so it is
 * also the thing that actually starts races.
 */
export async function getLobbyAdvanced(id: string): Promise<Lobby | null> {
  const lobby = await getLobby(id);
  if (!lobby) return null;

  const nowMs = Date.now();
  if (lobby.state === 'open' && new Date(lobby.fillDeadline).getTime() <= nowMs) {
    return withLock(() => lockLobby(lobby));
  }
  if (
    lobby.state === 'locked' &&
    lobby.submitDeadline &&
    new Date(lobby.submitDeadline).getTime() <= nowMs
  ) {
    return withLock(() => settleLobby(lobby));
  }
  return lobby;
}


export type { Lobby, SeatRecord, Player };
