import { NextResponse } from 'next/server';
import { getOrCreatePlayer, adjustBalance } from '@/lib/db/store';
import { getCurrentDrawing } from '@/lib/megapot/drawing';
import { entryFeeUnits } from '@/lib/vault/economy';

export const dynamic = 'force-dynamic';

/**
 * Grant play credits without a real deposit — OFF unless explicitly enabled.
 *
 * This exists for two callers and no others: the end-to-end suite, which cannot
 * source testnet USDC from a faucet on demand, and a demo where a judge should
 * be racing in one click rather than hunting for a faucet.
 *
 * It is gated on an environment variable that defaults to off, refuses to run on
 * mainnet under any setting, and writes a clearly-labelled ledger row so
 * granted credits are never mistaken for deposited ones. An unset variable must
 * never mean "hand out money".
 */
const ENABLED = process.env.RALLY_DEV_FAUCET === 'true';
const GRANT_ENTRIES = 20n;

export async function POST(req: Request) {
  if (!ENABLED) {
    return NextResponse.json(
      { ok: false, error: 'The dev faucet is disabled. Deposit USDC from your wallet instead.' },
      { status: 404 },
    );
  }
  if (process.env.NEXT_PUBLIC_MEGAPOT_NETWORK === 'mainnet') {
    return NextResponse.json(
      { ok: false, error: 'The dev faucet refuses to run against mainnet.' },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const { address } = (body ?? {}) as { address?: unknown };

  if (typeof address !== 'string' || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: 'A valid address is required' }, { status: 400 });
  }

  const drawing = await getCurrentDrawing();
  const grant = entryFeeUnits(drawing.ticketPrice) * GRANT_ENTRIES;

  const player = await getOrCreatePlayer(address);
  const updated = await adjustBalance({
    playerId: player.id,
    field: 'creditsUnits',
    deltaUnits: grant,
    kind: 'deposit',
    note: 'Dev faucet — test credits, not a real deposit',
  });

  return NextResponse.json({
    ok: true,
    grantedUnits: grant.toString(),
    creditsUnits: updated.creditsUnits,
  });
}
