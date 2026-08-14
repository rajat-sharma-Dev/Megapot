import { NextResponse } from 'next/server';
import { listRecentSettledLobbies, toUnits } from '@/lib/db/store';
import { advanceLobbies } from '@/lib/vault/lobby';

export const dynamic = 'force-dynamic';

/**
 * The high score table.
 *
 * An arcade cabinet's attract cycle always ends on the scores, because a name
 * somebody else put there is the most persuasive thing on the screen — it proves
 * the machine pays out and that a human did it. This is that, with the pot and
 * the ticket attached so the claim is checkable rather than atmospheric.
 *
 * House wins are included on purpose. A board showing only human victories would
 * be a lie about the odds.
 */
export async function GET() {
  await advanceLobbies().catch(() => {});

  const lobbies = await listRecentSettledLobbies(12);

  const winners = lobbies
    .filter((l) => l.settlement && !l.settlement.refunded && l.settlement.winnerName)
    .map((l) => {
      const s = l.settlement!;
      const top = s.standings.find((r) => r.isWinner);
      return {
        lobbyId: l.id,
        settledAt: s.settledAt,
        name: s.winnerName!,
        isHouse: s.winnerKind === 'bot',
        points: top?.points ?? 0,
        /** True when the winner did not cross the line first — the whole design. */
        wonFromBehind: (top?.placement ?? 1) > 1,
        placement: top?.placement ?? 1,
        potUnits: s.potUnits,
        stakedSeats: s.stakedSeats,
        ticketsMinted: s.ticketsMinted,
      };
    });

  const humanWins = winners.filter((w) => !w.isHouse).length;

  return NextResponse.json({
    ok: true,
    winners,
    totals: {
      races: lobbies.length,
      humanWins,
      ticketsMinted: lobbies.reduce((s, l) => s + (l.settlement?.ticketsMinted ?? 0), 0),
      potUnits: lobbies
        .reduce((s, l) => s + toUnits(l.settlement?.potUnits), 0n)
        .toString(),
    },
  });
}
