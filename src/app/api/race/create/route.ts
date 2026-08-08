import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getCurrentDrawing } from '@/lib/megapot/drawing';
import { getOrCreatePlayer, createRace, getOrbRollover } from '@/lib/db/store';
import { buildRacerSlots } from '@/lib/game/replay';

export const dynamic = 'force-dynamic';

const isAddress = (a: unknown): a is string =>
  typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * Issue a race.
 *
 * The seed is generated server-side and stored, so the client cannot pick a
 * track it has already practised, and the submitted result must replay against
 * this exact seed to count.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { address, name } = body ?? {};

    if (!isAddress(address)) {
      return NextResponse.json({ ok: false, error: 'A valid wallet address is required' }, { status: 400 });
    }

    const player = await getOrCreatePlayer(address, name);

    // Ball ranges come from the live drawing and are stamped onto the race, so
    // the track's Shard numbers are valid for the drawing they'll be bought into.
    const drawing = await getCurrentDrawing();

    const raceId = randomBytes(12).toString('hex');
    const seed = randomBytes(4).readUInt32BE(0);
    const rolloverCount = await getOrbRollover();

    await createRace({
      id: raceId,
      seed,
      playerId: player.id,
      ballMax: drawing.ballMax,
      bonusballMax: drawing.bonusballMax,
      rolloverCount,
    });

    return NextResponse.json({
      ok: true,
      raceId,
      seed,
      ballMax: drawing.ballMax,
      bonusballMax: drawing.bonusballMax,
      rolloverCount,
      drawingId: drawing.drawingId.toString(),
      slots: buildRacerSlots(raceId, player.name),
      player: {
        id: player.id,
        name: player.name,
        pointBank: player.pointBank,
        cookiePieces: player.cookiePieces,
      },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
