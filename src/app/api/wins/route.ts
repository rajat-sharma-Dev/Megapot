import { NextResponse } from 'next/server';
import { getWalletWins, formatAmount, type Win } from '@/lib/megapot/api';
import { listTickets } from '@/lib/db/store';
import { CONTRACTS, txUrl } from '@/lib/megapot/addresses';

export const dynamic = 'force-dynamic';

/**
 * Winning tickets for a wallet, and which of them are still unclaimed.
 *
 * Proxied through the server rather than called from the browser for two
 * reasons: the Data API key (if one is set) stays server-side, and the response
 * is cross-referenced against our own ticket records so the UI can say which
 * wins came out of a Rally Vault pot rather than being bought elsewhere.
 *
 * Note what this route deliberately does NOT do: claim anything. The tickets are
 * ERC-721s in the player's own wallet, so only they can sign
 * `Jackpot.claimWinnings`. A server that could claim on their behalf would be a
 * server that could redirect their winnings.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address');

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: 'A valid address is required' }, { status: 400 });
  }

  let wins: Win[] = [];
  let apiError: string | null = null;
  try {
    const res = await getWalletWins(address);
    wins = Array.isArray(res?.data) ? res.data : [];
  } catch (err) {
    apiError = (err as Error).message;
  }

  // Which of these did we mint? Ours are recorded by transaction hash.
  const ourTxs = new Set((await listTickets(address)).map((t) => t.txHash.toLowerCase()));

  const rows = wins.map((w) => ({
    id: w.id,
    roundId: w.round_id,
    ticketId: w.user_ticket_id,
    normals: w.normals,
    bonusball: w.bonusball,
    matchedNormals: w.matched_normals,
    bonusballMatch: w.bonusball_match,
    amount: w.amount,
    amountFormatted: w.amount ? formatAmount(w.amount) : '0',
    claimed: !!w.claimed,
    claimedTxUrl: w.claimed_tx_hash ? txUrl(w.claimed_tx_hash) : null,
    purchaseTxUrl: w.tx_hash ? txUrl(w.tx_hash) : null,
    fromRallyVault: !!w.tx_hash && ourTxs.has(w.tx_hash.toLowerCase()),
    createdAt: w.created_at,
  }));

  const unclaimed = rows.filter((r) => !r.claimed);

  const sum = (list: typeof rows) =>
    list
      .reduce((acc, r) => acc + BigInt(r.amount?.amount ?? '0'), 0n)
      .toString();

  return NextResponse.json({
    ok: true,
    /** Exactly the argument `Jackpot.claimWinnings(uint256[])` takes. */
    claimableTicketIds: unclaimed.map((r) => r.ticketId),
    unclaimedUnits: sum(unclaimed),
    totalWonUnits: sum(rows),
    wins: rows,
    jackpotAddress: CONTRACTS.jackpot,
    apiError,
  });
}
