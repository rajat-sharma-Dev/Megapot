import { NextResponse } from 'next/server';
import { getLobbyAdvanced } from '@/lib/vault/lobby';
import { toLobbyView } from '@/lib/vault/serialize';

export const dynamic = 'force-dynamic';

/**
 * Poll a lobby.
 *
 * This is the matchmaking screen's heartbeat, and it is also what actually
 * starts races: reading a lobby whose fill deadline has passed is what locks it
 * and seats the house. There is no scheduler anywhere in this app — the next
 * request is the scheduler.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const address = new URL(req.url).searchParams.get('address');

  const lobby = await getLobbyAdvanced(id);
  if (!lobby) {
    return NextResponse.json({ ok: false, error: 'Unknown lobby' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, lobby: toLobbyView(lobby, address) });
}
