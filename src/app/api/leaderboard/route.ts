import { NextResponse } from 'next/server';
import { listPlayers, listTickets, getLadder, getDay, listDays, toUnits } from '@/lib/db/store';
import { getCurrentDrawing } from '@/lib/megapot/drawing';
import { allocateTickets, poolToTickets } from '@/lib/vault/allocate';
import { settleDueDays, entryFeeUnits, ENTRIES_PER_TICKET } from '@/lib/vault/ladder';
import { dayWindow } from '@/lib/vault/day';

export const dynamic = 'force-dynamic';

/**
 * The boards.
 *
 * `today` is the one that matters: it carries each player's live projected ticket
 * count, recomputed from the pool as it stands right now. Showing the projection
 * rather than just the ranking is the whole retention argument — a player can see
 * that one more good race moves them from 0 tickets to 1, with hours left to do
 * it, instead of having to guess what a rank is worth.
 */
export async function GET() {
  // Whoever loads the board first after 17:00 UTC triggers yesterday's payout.
  await settleDueDays().catch(() => []);

  const win = dayWindow();
  const [ladder, day, players, tickets, drawing] = await Promise.all([
    getLadder(win.key),
    getDay(win.key),
    listPlayers(),
    listTickets(),
    getCurrentDrawing(),
  ]);

  const poolUnits = toUnits(day?.poolUnits);
  const { tickets: projectedTickets, carryOutUnits } = poolToTickets(poolUnits, drawing.ticketPrice);

  const projection = allocateTickets(
    ladder.map((e) => ({ playerId: e.playerId, name: e.name, points: e.points })),
    projectedTickets,
  );
  const projectedFor = new Map(projection.map((a) => [a.playerId, a.tickets]));

  const today = ladder.map((e, i) => ({
    rank: i + 1,
    address: e.playerId,
    name: e.name,
    points: e.points,
    races: e.races,
    bestScore: e.bestScore,
    retired: e.retired,
    projectedTickets: projectedFor.get(e.playerId) ?? 0,
  }));

  const allTime = [...players]
    .filter((p) => p.lifetimePoints > 0)
    .sort((a, b) => b.lifetimePoints - a.lifetimePoints)
    .slice(0, 50)
    .map((p, i) => ({
      rank: i + 1,
      address: p.id,
      name: p.name,
      lifetimePoints: p.lifetimePoints,
      racesCompleted: p.racesCompleted,
      bestRaceScore: p.bestRaceScore,
      ticketsEarned: p.ticketsEarned,
    }));

  const feared = [...players]
    .filter((p) => p.totalStolen > 0)
    .sort((a, b) => b.totalStolen - a.totalStolen)
    .slice(0, 20)
    .map((p, i) => ({ rank: i + 1, address: p.id, name: p.name, steals: p.totalStolen }));

  const settled = (await listDays())
    .filter((d) => d.settlement)
    .slice(0, 7)
    .map((d) => ({
      key: d.key,
      ticketsBought: d.settlement!.ticketsBought,
      entries: d.entries,
      winners: d.settlement!.allocations
        .filter((a) => a.tickets > 0)
        .map((a) => ({ rank: a.rank, name: a.name, address: a.playerId, tickets: a.tickets })),
    }));

  return NextResponse.json({
    ok: true,
    day: {
      key: win.key,
      opensAt: win.opensAt,
      closesAt: win.closesAt,
      entries: day?.entries ?? 0,
      poolUnits: poolUnits.toString(),
      carryInUnits: day?.carryInUnits ?? '0',
      projectedTickets,
      remainderUnits: carryOutUnits.toString(),
      ticketPriceUnits: drawing.ticketPrice.toString(),
      entryFeeUnits: entryFeeUnits(drawing.ticketPrice).toString(),
      entriesPerTicket: Number(ENTRIES_PER_TICKET),
      settled: !!day?.settlement,
    },
    today,
    allTime,
    feared,
    recentDays: settled,
    totals: {
      players: players.length,
      races: players.reduce((s, p) => s + p.racesCompleted, 0),
      ticketsMinted: tickets.reduce((s, t) => s + t.count, 0),
    },
  });
}
