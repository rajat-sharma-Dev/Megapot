import { NextResponse } from 'next/server';
import { getOrCreatePlayer, listTickets, getLadder, getDay, toUnits } from '@/lib/db/store';
import { getCurrentDrawing } from '@/lib/megapot/drawing';
import { allocateTickets, poolToTickets } from '@/lib/vault/allocate';
import { ensureDailyGrant, entryFeeUnits, FREE_ENTRIES_PER_DAY } from '@/lib/vault/ladder';
import { dayWindow } from '@/lib/vault/day';

export const dynamic = 'force-dynamic';

/**
 * Player profile: credits, today's standing and projected tickets, and the
 * tickets the vault has already minted to this wallet.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address');

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: 'A valid address is required' }, { status: 400 });
  }

  const win = dayWindow();
  const drawing = await getCurrentDrawing();
  const feeUnits = entryFeeUnits(drawing.ticketPrice);

  // Landing on the profile is enough to pick up today's free-entry allowance, so
  // a returning player is never staring at a zero balance with no way forward.
  let player = await getOrCreatePlayer(address);
  player = await ensureDailyGrant(player, win.key, feeUnits);

  const [tickets, ladder, day] = await Promise.all([
    listTickets(player.id),
    getLadder(win.key),
    getDay(win.key),
  ]);

  const poolUnits = toUnits(day?.poolUnits);
  const { tickets: projectedTickets } = poolToTickets(poolUnits, drawing.ticketPrice);
  const projection = allocateTickets(
    ladder.map((e) => ({ playerId: e.playerId, name: e.name, points: e.points })),
    projectedTickets,
  );

  const mineIdx = ladder.findIndex((e) => e.playerId === player.id);
  const mine = mineIdx >= 0 ? ladder[mineIdx] : null;
  const myProjection = projection.find((a) => a.playerId === player.id);

  // What the next rank up is worth, so the UI can say "12 points to 1 ticket".
  const above = mineIdx > 0 ? ladder[mineIdx - 1] : null;

  return NextResponse.json({
    ok: true,
    player,
    tickets,
    credits: {
      units: player.credits,
      entriesAffordable: feeUnits > 0n ? Number(toUnits(player.credits) / feeUnits) : 0,
      entryFeeUnits: feeUnits.toString(),
      freeEntriesPerDay: Number(FREE_ENTRIES_PER_DAY),
    },
    today: {
      key: win.key,
      closesAt: win.closesAt,
      rank: mineIdx >= 0 ? mineIdx + 1 : null,
      players: ladder.length,
      points: mine?.points ?? 0,
      races: mine?.races ?? 0,
      bestScore: mine?.bestScore ?? 0,
      projectedTickets: myProjection?.tickets ?? 0,
      pointsToNextRank: above ? Math.max(1, above.points - (mine?.points ?? 0) + 1) : null,
      poolUnits: poolUnits.toString(),
      projectedTicketsTotal: projectedTickets,
    },
  });
}
