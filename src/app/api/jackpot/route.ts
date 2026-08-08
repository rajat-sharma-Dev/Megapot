import { NextResponse } from 'next/server';
import { getCurrentDrawing, formatUsdc } from '@/lib/megapot/drawing';
import { NETWORK, CONTRACTS, CHAIN_ID } from '@/lib/megapot/addresses';

export const dynamic = 'force-dynamic';

/** Live Megapot drawing state for the Hub ticker and the draw countdown. */
export async function GET() {
  try {
    const d = await getCurrentDrawing();
    return NextResponse.json({
      ok: true,
      network: NETWORK,
      chainId: CHAIN_ID,
      jackpotAddress: CONTRACTS.jackpot,
      drawingId: d.drawingId.toString(),
      prizePool: d.prizePool.toString(),
      prizePoolFormatted: formatUsdc(d.prizePool),
      ticketPrice: d.ticketPrice.toString(),
      ticketPriceFormatted: formatUsdc(d.ticketPrice),
      ballMax: d.ballMax,
      bonusballMax: d.bonusballMax,
      ticketsBought: d.globalTicketsBought.toString(),
      drawingTimeMs: Number(d.drawingTime) * 1000,
      jackpotLock: d.jackpotLock,
      referralFeePct: Number(d.referralFee) / 1e16,
      referralWinSharePct: Number(d.referralWinShare) / 1e16,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 502 },
    );
  }
}
