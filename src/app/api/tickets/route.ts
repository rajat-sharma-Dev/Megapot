import { NextResponse } from 'next/server';
import { listTickets } from '@/lib/db/store';
import { getWalletTickets } from '@/lib/megapot/api';
import { txUrl } from '@/lib/megapot/addresses';

export const dynamic = 'force-dynamic';

/**
 * Tickets for a wallet.
 *
 * `local` is what Rally Vault minted (with the earned-vs-filled provenance the
 * chain doesn't record). `onchain` is Megapot's own view of the same wallet —
 * showing both proves the tickets are real and not just rows in our database.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address');

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: 'A valid address is required' }, { status: 400 });
  }

  const local = (await listTickets(address)).map((t) => ({ ...t, explorerUrl: txUrl(t.txHash) }));

  let onchain: unknown = null;
  let onchainError: string | null = null;
  try {
    onchain = await getWalletTickets(address);
  } catch (err) {
    onchainError = (err as Error).message;
  }

  return NextResponse.json({ ok: true, local, onchain, onchainError });
}
