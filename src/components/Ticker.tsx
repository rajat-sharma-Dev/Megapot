'use client';

import { formatUsdc } from '@/lib/format';
import { liveGames } from '@/lib/games';
import type { Jackpot, RecentFeed } from '@/lib/hooks';

/**
 * The marquee.
 *
 * Borrowed wholesale from arcade cabinets and betting shops, and it earns its
 * place for the same reason it did there: a scrolling line of live numbers says
 * "this is running right now" faster than any static panel can. Every value on
 * it is read from the chain or from settled races — nothing here is copy.
 *
 * The track is duplicated in the markup and translates exactly -50%, which is
 * what makes the loop seamless; animating a single copy to -100% leaves a
 * visible gap every cycle. It pauses on hover so a number you want to read
 * doesn't slide away.
 */
export function Ticker({
  jackpot,
  recent,
}: {
  jackpot: Jackpot | null;
  recent: RecentFeed | null;
}) {
  const items = [
    jackpot && `MEGAPOT JACKPOT $${jackpot.prizePoolFormatted}`,
    jackpot && `TICKET $${jackpot.ticketPriceFormatted}`,
    jackpot && `YOUR SEAT ${formatUsdc(jackpot.economy.entryFeeUnits)}`,
    'FIVE PLAYERS · ONE POT · ONE WINNER',
    `${liveGames().length} GAME LIVE · MORE IN DEVELOPMENT`,
    recent?.totals.ticketsMinted
      ? `${recent.totals.ticketsMinted} REAL TICKETS WON HERE`
      : 'A FULL TABLE IS ONE REAL TICKET',
    jackpot && `${Number(jackpot.ticketsBought).toLocaleString()} TICKETS IN THIS ROUND`,
    'HIGHEST SCORE TAKES THE POT',
    jackpot?.network === 'mainnet' ? 'LIVE ON BASE' : 'LIVE ON BASE SEPOLIA',
  ].filter(Boolean) as string[];

  if (!items.length) return null;

  return (
    <div className="marquee relative z-20 border-b border-white/[0.09] bg-black/60 py-2 backdrop-blur-sm">
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
            {items.map((text, i) => (
              <span
                key={`${copy}-${i}`}
                className="display flex items-center gap-4 px-6 text-[11px] font-semibold tracking-[0.2em] text-slate-400"
              >
                <span className="text-[var(--gold)]">◆</span>
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
