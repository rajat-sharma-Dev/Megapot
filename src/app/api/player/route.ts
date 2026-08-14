import { NextResponse } from 'next/server';
import {
  getOrCreatePlayer, listTickets, listLedger, listLobbiesForPlayer, toUnits,
} from '@/lib/db/store';
import { getCurrentDrawing } from '@/lib/megapot/drawing';
import { entryFeeUnits, SEATS_PER_RACE } from '@/lib/vault/economy';
import { advanceLobbies } from '@/lib/vault/lobby';
import { txUrl } from '@/lib/megapot/addresses';

export const dynamic = 'force-dynamic';

/**
 * A player's whole state: what they can spend, what they've won and haven't
 * cashed into a ticket yet, the tickets they hold, and their recent races.
 *
 * The entry fee is derived here rather than stored, because ticket price is live
 * protocol state and the fee is a fraction of it.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const address = url.searchParams.get('address');

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return NextResponse.json({ ok: false, error: 'A valid address is required' }, { status: 400 });
  }

  void advanceLobbies().catch(() => {});

  const drawing = await getCurrentDrawing();
  const feeUnits = entryFeeUnits(drawing.ticketPrice);

  const player = await getOrCreatePlayer(address);
  const [tickets, ledger, lobbies] = await Promise.all([
    listTickets(player.id),
    listLedger(player.id, 40),
    listLobbiesForPlayer(player.id, 15),
  ]);

  const credits = toUnits(player.creditsUnits);

  const history = lobbies
    .filter((l) => l.state === 'settled' && l.settlement)
    .map((l) => {
      const seat = l.seats.find((s) => s.id === player.id);
      return {
        lobbyId: l.id,
        settledAt: l.settlement!.settledAt,
        points: seat?.points ?? 0,
        placement: seat?.placement ?? null,
        retired: seat?.retired ?? null,
        won: l.settlement!.winnerId === player.id,
        potUnits: l.settlement!.potUnits,
        stakedSeats: l.settlement!.stakedSeats,
        winnerName: l.settlement!.winnerName,
        houseWins: l.settlement!.houseWins,
        ticketsMinted: l.settlement!.ticketsMinted,
      };
    });

  return NextResponse.json({
    ok: true,
    player: {
      id: player.id,
      name: player.name,
      racesPlayed: player.racesPlayed,
      racesWon: player.racesWon,
      racesRetired: player.racesRetired,
      lifetimePoints: player.lifetimePoints,
      bestRaceScore: player.bestRaceScore,
      totalStolen: player.totalStolen,
      ticketsEarned: player.ticketsEarned,
      createdAt: player.createdAt,
    },
    balance: {
      creditsUnits: credits.toString(),
      entriesAffordable: feeUnits > 0n ? Number(credits / feeUnits) : 0,
      entryFeeUnits: feeUnits.toString(),
      lifetimeDepositedUnits: player.lifetimeDepositedUnits,
      lifetimeWithdrawnUnits: player.lifetimeWithdrawnUnits,
      lifetimeWageredUnits: player.lifetimeWageredUnits,
      lifetimeWonUnits: player.lifetimeWonUnits,
    },
    economy: {
      seatsPerRace: SEATS_PER_RACE,
      ticketPriceUnits: drawing.ticketPrice.toString(),
    },
    tickets: tickets.map((t) => ({
      ...t,
      simulated: !!t.simulated,
      ticketIds: Array.isArray(t.ticketIds) ? t.ticketIds : [],
      // A simulated purchase broadcast nothing, so there is no transaction to link.
      explorerUrl: t.simulated ? null : txUrl(t.txHash),
    })),
    ledger: ledger.map((e) => ({ ...e, explorerUrl: e.txHash ? txUrl(e.txHash) : null })),
    history,
  });
}
