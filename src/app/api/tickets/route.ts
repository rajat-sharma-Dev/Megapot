import { NextResponse } from 'next/server';
import { listTickets } from '@/lib/db/store';
import { getWalletTickets, getWalletStats, type WalletTicket } from '@/lib/megapot/api';
import { txUrl } from '@/lib/megapot/addresses';
import { isDryRun } from '@/lib/megapot/purchase';

export const dynamic = 'force-dynamic';

/**
 * Tickets for a wallet, with their actual numbers.
 *
 * Two sources, joined. Our own records know the provenance the chain doesn't —
 * which race pot paid for a ticket — while Megapot's Data API knows the thing
 * that makes a ticket a ticket: the numbers on it. A ticket with no numbers is
 * a receipt, and showing one as though it were a lottery entry is the kind of
 * half-truth this route exists to avoid.
 *
 * Simulated tickets are marked and carry NO explorer link. A dry run broadcasts
 * nothing, so its hash resolves to "not found" on BaseScan — offering that link
 * tells a player their ticket is real and then lets the explorer call it a lie.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address');

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: 'A valid address is required' }, { status: 400 });
  }

  const records = await listTickets(address);

  let onchain: WalletTicket[] = [];
  let stats: unknown = null;
  let onchainError: string | null = null;
  try {
    const [tickets, walletStats] = await Promise.all([
      getWalletTickets(address),
      getWalletStats(address),
    ]);
    onchain = Array.isArray(tickets?.data) ? tickets.data : [];
    stats = walletStats;
  } catch (err) {
    onchainError = (err as Error).message;
  }

  /** Numbers, keyed by the protocol's ticket id, so a record can find its own. */
  const numbersById = new Map<string, { normals: number[]; bonusball: number; roundId?: string }>();
  for (const t of onchain) {
    const id = String(t.ticket_id ?? '');
    if (!id) continue;
    numbersById.set(id, {
      normals: Array.isArray(t.normals) ? (t.normals as number[]) : [],
      bonusball: typeof t.bonusball === 'number' ? t.bonusball : 0,
      roundId: t.round_id ? String(t.round_id) : undefined,
    });
  }

  const local = records.map((t) => {
    const ids = Array.isArray(t.ticketIds) ? t.ticketIds : [];
    const numbers = ids
      .map((id) => numbersById.get(id))
      .filter(Boolean)
      .map((n) => ({ normals: n!.normals, bonusball: n!.bonusball }));

    return {
      ...t,
      simulated: !!t.simulated,
      ticketIds: ids,
      numbers,
      /** Null for a simulated purchase — see the note at the top. */
      explorerUrl: t.simulated ? null : txUrl(t.txHash),
    };
  });

  return NextResponse.json({
    ok: true,
    local,
    totalTickets: local.reduce((s, t) => s + t.count, 0),
    realTickets: local.filter((t) => !t.simulated).reduce((s, t) => s + t.count, 0),
    simulatedTickets: local.filter((t) => t.simulated).reduce((s, t) => s + t.count, 0),
    /**
     * Whether purchases are currently simulated. Surfaced so the UI can explain
     * an empty ticket rather than leaving a player to discover it on BaseScan.
     */
    dryRun: isDryRun(),
    onchain,
    stats,
    onchainError,
  });
}
