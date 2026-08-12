/**
 * The race pot — who wins it, and what it is worth.
 *
 * One race, one winner, winner takes everything staked. There is no ladder and
 * no leaderboard: a race is settled the moment its lobby resolves, and the value
 * moves immediately.
 *
 * The part that matters most is how the winner is chosen. It is NOT the racer
 * who crossed the line first. It is the racer with the highest total points, and
 * finishing position is only one of the things that feeds that total. A driver
 * who came third but swept the point cells, held boost through the middle
 * section and kept a clean run genuinely beats a driver who won the sprint and
 * collected nothing. That is the whole design: the race rewards *driving*, not
 * just arriving.
 *
 * Pure and deterministic — no clock, no randomness, no I/O. Given the same seat
 * scores it always names the same winner, which is what lets the server settle a
 * lobby twice and get the same answer both times.
 */

import type { ScoreBreakdown } from '../points/scoring';

export type SeatKind = 'human' | 'bot';

export type PotSeat = {
  /** Seat index 0..4 — also the tie-breaker of last resort. */
  index: number;
  kind: SeatKind;
  /** Wallet address for a human seat, synthetic id for a bot. */
  id: string;
  name: string;
  /**
   * True when this seat put an entry fee into the pot. A human seat that paid
   * and then never drove still staked; its stake is forfeit to the winner.
   */
  staked: boolean;
  /** Null until the seat has been scored. An unscored seat cannot win. */
  score: ScoreBreakdown | null;
};

export type PotResult = {
  /** Every staked seat's entry fee, in USDC base units. */
  potUnits: bigint;
  /** How many entry fees are in the pot — the shard count the winner takes. */
  stakedSeats: number;
  winner: PotSeat | null;
  /** Seats ordered exactly as the results screen shows them. */
  standings: PotSeat[];
  /** True when the winner is a bot, so the pot returns to the house float. */
  houseWins: boolean;
};

/**
 * Total points for a seat. An unscored seat (never submitted a run) is a zero,
 * not an absence — it staked, it just didn't drive.
 */
export const seatPoints = (s: PotSeat): number => s.score?.total ?? 0;

/**
 * Rank the field.
 *
 * Points decide it. Everything after that is a tie-break, in the order a player
 * would expect to be asked about: who actually finished, who finished sooner,
 * who got further, and finally seat order so the result is never ambiguous.
 */
export function rankSeats(seats: PotSeat[]): PotSeat[] {
  return [...seats].sort((a, b) => {
    const pts = seatPoints(b) - seatPoints(a);
    if (pts !== 0) return pts;

    // A finisher beats a DNF on equal points — turning up matters.
    const aFin = a.score?.finished ? 1 : 0;
    const bFin = b.score?.finished ? 1 : 0;
    if (aFin !== bFin) return bFin - aFin;

    // Then the better track position.
    const place = (a.score?.placement ?? 99) - (b.score?.placement ?? 99);
    if (place !== 0) return place;

    const progress = (b.score?.progress ?? 0) - (a.score?.progress ?? 0);
    if (progress !== 0) return progress;

    return a.index - b.index;
  });
}

/**
 * Resolve a settled lobby into a payout.
 *
 * A seat can only win if it scored above zero. A lobby where nobody scored
 * (everyone quit on the start line) has no winner and the pot is returned
 * rather than handed to whoever happened to sit in seat 0 — see `refundSeats`.
 */
export function resolvePot(seats: PotSeat[], entryFeeUnits: bigint): PotResult {
  const staked = seats.filter((s) => s.staked);
  const standings = rankSeats(seats);
  const top = standings[0];
  const winner = top && seatPoints(top) > 0 ? top : null;

  return {
    potUnits: entryFeeUnits * BigInt(staked.length),
    stakedSeats: staked.length,
    winner,
    standings,
    houseWins: winner?.kind === 'bot',
  };
}

/**
 * Seats owed their stake back.
 *
 * Only ever non-empty when a race produced no winner at all. Refunding beats
 * pocketing it: a lobby that failed to produce a race was not a game anyone
 * lost, and quietly keeping five entry fees for it would be theft.
 */
export function refundSeats(result: PotResult, seats: PotSeat[]): PotSeat[] {
  return result.winner ? [] : seats.filter((s) => s.staked);
}

/**
 * How the winner's margin reads on the results screen.
 *
 * Returned as a structure rather than a sentence so the UI can style the two
 * halves differently — the gap is the drama, the runner-up is the context.
 */
export function winMargin(standings: PotSeat[]): { gap: number; runnerUp: PotSeat | null } {
  const [first, second] = standings;
  if (!first || !second) return { gap: 0, runnerUp: null };
  return { gap: seatPoints(first) - seatPoints(second), runnerUp: second };
}

/**
 * Did the winner also cross the line first?
 *
 * Worth calling out in the UI when it is false, because it is the clearest
 * possible demonstration of the rule: "P3 — and still took the pot."
 */
export function wonFromBehind(winner: PotSeat | null): boolean {
  return !!winner?.score && winner.score.placement > 1;
}
