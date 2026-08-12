/**
 * Ticket allocation.
 *
 * A day's pool buys a whole number of Megapot tickets, and those tickets have to
 * be split across a ranked ladder. Two properties matter:
 *
 *  · Finishing higher must always be worth more — otherwise the ladder is noise.
 *  · Finishing *outside the top few* must still be worth something whenever there
 *    are enough tickets to go round, or everyone below the leader stops playing
 *    by mid-afternoon.
 *
 * Harmonic weights (1/rank) do both: rank 1 gets roughly twice rank 2, but the
 * tail decays slowly enough that a busy day spreads tickets deep into the board.
 * Integer tickets are then dealt by largest remainder, which is the standard
 * apportionment method and wastes nothing.
 *
 * Pure and deterministic — no clock, no randomness, same input same output.
 */

export type LadderStanding = {
  playerId: string;
  name: string;
  points: number;
};

export type Allocation = {
  playerId: string;
  name: string;
  rank: number;
  points: number;
  tickets: number;
};

/**
 * Rank the standings for allocation.
 *
 * Sorted by points descending, then by address so the order is stable and
 * reproducible for a given day — the server must be able to recompute an
 * identical allocation from stored data.
 */
export function rankStandings(standings: LadderStanding[]): LadderStanding[] {
  return [...standings]
    .filter((s) => s.points > 0)
    .sort((a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId));
}

export function allocateTickets(standings: LadderStanding[], ticketCount: number): Allocation[] {
  const ranked = rankStandings(standings);

  const base: Allocation[] = ranked.map((s, i) => ({
    playerId: s.playerId,
    name: s.name,
    rank: i + 1,
    points: s.points,
    tickets: 0,
  }));

  if (ticketCount <= 0 || base.length === 0) return base;

  // Harmonic weight per rank.
  const weights = base.map((a) => 1 / a.rank);
  const totalWeight = weights.reduce((s, w) => s + w, 0);

  // Exact (fractional) share, then floor and deal the remainder.
  const exact = weights.map((w) => (ticketCount * w) / totalWeight);
  let dealt = 0;
  base.forEach((a, i) => {
    a.tickets = Math.floor(exact[i]);
    dealt += a.tickets;
  });

  const remainder = ticketCount - dealt;
  if (remainder > 0) {
    // Largest fractional part wins; ties break toward the better rank.
    const order = base
      .map((a, i) => ({ i, frac: exact[i] - Math.floor(exact[i]), rank: a.rank }))
      .sort((x, y) => y.frac - x.frac || x.rank - y.rank);

    for (let k = 0; k < remainder; k++) base[order[k % order.length].i].tickets++;
  }

  return base;
}

/**
 * How the pool converts to tickets.
 *
 * Anything left over after buying whole tickets is not spent and not lost — it
 * carries into tomorrow's pool, so small days accumulate into real tickets
 * instead of evaporating.
 */
export function poolToTickets(poolUnits: bigint, ticketPriceUnits: bigint) {
  if (ticketPriceUnits <= 0n) {
    return { tickets: 0, spentUnits: 0n, carryOutUnits: poolUnits };
  }
  const tickets = poolUnits / ticketPriceUnits;
  const spentUnits = tickets * ticketPriceUnits;
  return {
    tickets: Number(tickets),
    spentUnits,
    carryOutUnits: poolUnits - spentUnits,
  };
}
