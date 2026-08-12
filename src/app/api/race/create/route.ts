import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getCurrentDrawing } from '@/lib/megapot/drawing';
import { createRace, getOrbRollover } from '@/lib/db/store';
import { buildRacerSlots } from '@/lib/game/replay';
import { chargeEntry, settleDueDays, entryFeeUnits } from '@/lib/vault/ladder';
import { dayWindow } from '@/lib/vault/day';

export const dynamic = 'force-dynamic';

const isAddress = (a: unknown): a is string =>
  typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * Issue a race.
 *
 * Charges the entry fee into today's pool, then generates a seed server-side and
 * stores it — so the client cannot pick a track it has already practised, and the
 * submitted result must replay against this exact seed to count.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { address, name } = body ?? {};

    if (!isAddress(address)) {
      return NextResponse.json({ ok: false, error: 'A valid wallet address is required' }, { status: 400 });
    }

    // Anyone arriving after 17:00 UTC pays out yesterday before playing today.
    await settleDueDays();

    const drawing = await getCurrentDrawing();
    const entry = await chargeEntry(address, typeof name === 'string' ? name : undefined, drawing.ticketPrice);

    const raceId = randomBytes(12).toString('hex');
    const seed = randomBytes(4).readUInt32BE(0);
    const rolloverCount = await getOrbRollover();

    await createRace({
      id: raceId,
      seed,
      playerId: entry.player.id,
      entryFeeUnits: entry.entryFeeUnits.toString(),
      dayKey: entry.dayKey,
      rolloverCount,
    });

    const win = dayWindow();

    return NextResponse.json({
      ok: true,
      raceId,
      seed,
      rolloverCount,
      slots: buildRacerSlots(raceId, entry.player.name),
      entry: {
        feeUnits: entry.entryFeeUnits.toString(),
        creditsAfter: entry.creditsAfter.toString(),
        poolUnits: entry.poolUnits.toString(),
        ticketPriceUnits: drawing.ticketPrice.toString(),
        entriesPerTicket: Number(drawing.ticketPrice / entryFeeUnits(drawing.ticketPrice)),
      },
      day: { key: entry.dayKey, closesAt: win.closesAt },
      drawingId: drawing.drawingId.toString(),
      player: {
        id: entry.player.id,
        name: entry.player.name,
        credits: entry.creditsAfter.toString(),
      },
    });
  } catch (err) {
    const msg = (err as Error).message;
    // Out of credits is the player's problem to solve, not a server fault.
    const status = msg.includes('Not enough credits') ? 402 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
