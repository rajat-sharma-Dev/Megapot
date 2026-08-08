import { NextResponse } from 'next/server';
import { getOrCreatePlayer, listTickets } from '@/lib/db/store';
import { TICKET_THRESHOLD, COOKIE_PIECES } from '@/lib/points/scoring';

export const dynamic = 'force-dynamic';

/** Player profile: Point Bank progress, Cookie progress, and minted tickets. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address');

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: 'A valid address is required' }, { status: 400 });
  }

  const player = await getOrCreatePlayer(address);
  const tickets = await listTickets(player.id);

  return NextResponse.json({
    ok: true,
    player,
    tickets,
    progress: {
      threshold: TICKET_THRESHOLD,
      pointBankPct: Math.min(100, (player.pointBank / TICKET_THRESHOLD) * 100),
      cookieProgress: player.cookiePieces % COOKIE_PIECES,
      cookiePieces: COOKIE_PIECES,
    },
  });
}
