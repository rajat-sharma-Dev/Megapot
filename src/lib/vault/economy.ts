/**
 * Economy constants and pure money math.
 *
 * Kept free of imports and environment on purpose: the client needs these to
 * show an entry fee, the server needs them to charge one, and the offline tests
 * need them to assert the arithmetic. Nothing here touches a clock, a wallet or
 * a database.
 *
 * The whole economy in three lines:
 *
 *   entry fee   = live ticket price / 5
 *   a race pot  = one entry fee per staked seat (so a full lobby = one ticket)
 *   5 shards    = one real Megapot ticket, minted to the winner's own wallet
 */

/** Every race is five seats. A full lobby stakes exactly one ticket's worth. */
export const SEATS_PER_RACE = 5;

/**
 * Shards per ticket.
 *
 * A shard is one entry fee's worth of value sitting in a player's vault. Five of
 * them buy a whole Megapot ticket, which is the same arithmetic as the seat
 * count and deliberately so — win a full five-human lobby and you walk out with
 * a whole ticket immediately, no waiting.
 */
export const SHARDS_PER_TICKET = 5n;

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
  ticketPriceUnits / SHARDS_PER_TICKET;

/**
 * How many whole shards a vault balance represents.
 *
 * Vault balances are held in USDC base units, not in a shard counter, because
 * the ticket price can move between the race that won the shard and the draw
 * that spends it. Units are the truth; shards are the display.
 */
export function shardsOf(vaultUnits: bigint, feeUnits: bigint): number {
  if (feeUnits <= 0n) return 0;
  return Number(vaultUnits / feeUnits);
}

/**
 * Split a vault balance into whole tickets and what's left over.
 *
 * The remainder is not lost and not spent — it stays in the vault and counts
 * toward the next ticket, so a player who keeps winning small pots eventually
 * gets a whole ticket out of them.
 */
export function vaultToTickets(vaultUnits: bigint, ticketPriceUnits: bigint) {
  if (ticketPriceUnits <= 0n) {
    return { tickets: 0, spentUnits: 0n, remainderUnits: vaultUnits };
  }
  const tickets = vaultUnits / ticketPriceUnits;
  const spentUnits = tickets * ticketPriceUnits;
  return {
    tickets: Number(tickets),
    spentUnits,
    remainderUnits: vaultUnits - spentUnits,
  };
}

/**
 * Progress toward the next whole ticket, 0..1. Drives the vault meter.
 */
export function ticketProgress(vaultUnits: bigint, ticketPriceUnits: bigint): number {
  if (ticketPriceUnits <= 0n) return 0;
  const remainder = vaultUnits % ticketPriceUnits;
  return Number((remainder * 10_000n) / ticketPriceUnits) / 10_000;
}

/**
 * Minimum deposit, expressed in entries rather than dollars for the same reason
 * the fee is: one entry on mainnet is $0.20 and on testnet $0.002, and a fixed
 * floor would be either meaningless or prohibitive depending on the network.
 */
export const MIN_DEPOSIT_ENTRIES = 5n;

export const minDepositUnits = (ticketPriceUnits: bigint): bigint =>
  entryFeeUnits(ticketPriceUnits) * MIN_DEPOSIT_ENTRIES;
