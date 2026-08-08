import { NextResponse } from 'next/server';
import { listPlayers, listTickets } from '@/lib/db/store';

export const dynamic = 'force-dynamic';

/**
 * Leaderboards: lifetime points, plus "Most Feared Racer" ranked by points
 * stolen from rivals — a second axis so aggressive play has its own standing.
 */
export async function GET() {
  const players = await listPlayers();
  const tickets = await listTickets();

  const points = [...players]
    .sort((a, b) => b.lifetimePoints - a.lifetimePoints)
    .slice(0, 50)
    .map((p, i) => ({
      rank: i + 1,
      address: p.id,
      name: p.name,
      lifetimePoints: p.lifetimePoints,
      racesCompleted: p.racesCompleted,
      ticketsEarned: p.ticketsEarned,
    }));

  const feared = [...players]
    .filter((p) => p.totalStolen > 0)
    .sort((a, b) => b.totalStolen - a.totalStolen)
    .slice(0, 20)
    .map((p, i) => ({ rank: i + 1, address: p.id, name: p.name, steals: p.totalStolen }));

  return NextResponse.json({
    ok: true,
    points,
    feared,
    totals: {
      players: players.length,
      races: players.reduce((s, p) => s + p.racesCompleted, 0),
      ticketsMinted: tickets.length,
    },
  });
}
