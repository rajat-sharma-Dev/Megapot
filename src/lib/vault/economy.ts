/**
 * Economy constants and pure money math.
 *
 * Kept free of imports and environment on purpose: the client needs these to
 * show an entry fee, the server needs them to charge one, and the offline tests
 * need them to assert the arithmetic. Nothing here touches a clock, a wallet or
 * a database.
 *
 * The whole economy in two lines:
 *
 *   entry fee = live ticket price / 5      (one seat = one fifth of a ticket)
 *   win a pot = every stake in it, which for a full table is exactly one ticket
 *
 * There is no intermediate currency. An earlier version banked winnings as
 * "shards" that accumulated toward a ticket, which was a solution to a problem
 * this game does not have: the house stakes every empty seat, so a full table is
 * the normal case and a pot is a whole ticket. Winners now get a ticket, and any
 * amount too small to buy one goes straight back to their spendable balance.
 */

/** Every race is five seats. A full table stakes exactly one ticket's worth. */
export const SEATS_PER_RACE = 5;

/**
 * The entry fee, as a divisor of the live ticket price rather than a fixed
 * dollar amount.
 *
 * Ticket price is per-drawing protocol state and genuinely differs between
 * networks — $1.00 on Base mainnet, $0.01 on Base Sepolia. Hardcoding "$0.20"
 * would make the testnet entry fee twenty times the price of the ticket it is
 * supposed to be buying a fifth of.
 */
export const entryFeeUnits = (ticketPriceUnits: bigint): bigint =>
  ticketPriceUnits / BigInt(SEATS_PER_RACE);

/**
 * Turn a won pot into tickets.
 *
 * Whole tickets only — the protocol does not sell fractions. Whatever is left
 * over is returned to the winner's spendable balance rather than held back,
 * because value a player cannot see or spend is value they will reasonably
 * assume you lost.
 *
 * In the ordinary case (five staked seats) the pot is exactly one ticket and the
 * remainder is zero. A short pot happens only when the house float ran dry and
 * some seats raced unstaked; then nothing is bought and the whole pot is
 * refunded to the balance.
 */
export function potToTickets(potUnits: bigint, ticketPriceUnits: bigint) {
  if (ticketPriceUnits <= 0n) {
    return { tickets: 0, spentUnits: 0n, remainderUnits: potUnits };
  }
  const tickets = potUnits / ticketPriceUnits;
  const spentUnits = tickets * ticketPriceUnits;
  return {
    tickets: Number(tickets),
    spentUnits,
    remainderUnits: potUnits - spentUnits,
  };
}

/**
 * Minimum deposit, expressed in entries rather than dollars for the same reason
 * the fee is: one entry on mainnet is $0.20 and on testnet $0.002, and a fixed
 * floor would be either meaningless or prohibitive depending on the network.
 */
export const MIN_DEPOSIT_ENTRIES = 5n;

export const minDepositUnits = (ticketPriceUnits: bigint): bigint =>
  entryFeeUnits(ticketPriceUnits) * MIN_DEPOSIT_ENTRIES;
