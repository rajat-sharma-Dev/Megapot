/**
 * The Jackpot calls the BROWSER makes.
 *
 * Deliberately a hand-written subset rather than an import of `Jackpot.json`:
 * the full ABI is ~2,500 lines and importing it into a client component ships
 * every one of them to every visitor for the sake of a single function.
 *
 * There is exactly one entry here, and it is the one call in the whole protocol
 * that a player must sign for themselves — the ticket is an ERC-721 in their
 * wallet, so nobody else can redeem it, by design.
 */
export const JACKPOT_CLAIM_ABI = [
  {
    type: 'function',
    name: 'claimWinnings',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'ticketIds', type: 'uint256[]' }],
    outputs: [],
  },
] as const;
