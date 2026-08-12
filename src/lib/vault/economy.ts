/**
 * Economy constants and pure money math.
 *
 * Split out from `ladder.ts` deliberately: that module is `server-only` because
 * it holds the treasury path, but these numbers are needed by the client (to
 * show an entry fee) and by the offline tests (to assert the arithmetic). Pure,
 * no imports, no environment.
 */

/**
 * Five entries fund one ticket.
 *
 * Expressed as a divisor of the live ticket price rather than a fixed dollar
 * amount, because the price is per-drawing protocol state and genuinely differs
 * between networks — $1.00 on Base mainnet, $0.01 on Sepolia. Hardcoding "$0.20"
 * would make the testnet entry fee twenty times the price of the ticket it is
 * supposed to be buying a fifth of.
 */
export const ENTRIES_PER_TICKET = 5n;

export const entryFeeUnits = (ticketPriceUnits: bigint) => ticketPriceUnits / ENTRIES_PER_TICKET;

/**
 * Free play allowance.
 *
 * Every player is topped up to this many entries once per vault day. The wallet
 * this game generates on first visit has no funds and no way to get any, so
 * without a grant there is nothing to test and nothing to demo.
 */
export const FREE_ENTRIES_PER_DAY = 25n;
