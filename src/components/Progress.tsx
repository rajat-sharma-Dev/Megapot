'use client';

import { formatUsdc } from '@/lib/format';

/**
 * The day's pool, filling toward the next whole ticket.
 *
 * This is the clearest statement of the economy anywhere in the UI: five entries
 * make one ticket, and you can watch the fifth one land. The remainder bar is
 * honest about the fact that a part-filled ticket isn't lost — it rolls over.
 */
export function PoolMeter({
  poolUnits,
  ticketPriceUnits,
  projectedTickets,
  entries,
  compact,
}: {
  poolUnits: string;
  ticketPriceUnits: string;
  projectedTickets: number;
  entries: number;
  compact?: boolean;
}) {
  const pool = BigInt(poolUnits || '0');
  const price = BigInt(ticketPriceUnits || '0');

  const remainder = price > 0n ? pool % price : 0n;
  const pct = price > 0n ? Number((remainder * 1000n) / price) / 10 : 0;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="stat-label">Today&apos;s pool</span>
        <span className="num text-sm text-slate-300">
          <span className="font-bold text-[var(--accent)]">{formatUsdc(pool)}</span>
          <span className="text-slate-600"> · {entries} entries</span>
        </span>
      </div>

      {/* Whole tickets already funded, then progress toward the next one. */}
      <div className="flex items-center gap-2">
        <div className="num shrink-0 text-2xl font-extrabold text-[var(--gold)]">
          {projectedTickets}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="bar-grow h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background: 'linear-gradient(90deg, #b45309, #fbbf24)',
                boxShadow: '0 0 14px rgba(251,191,36,0.5)',
              }}
            />
          </div>
        </div>
      </div>

      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          {projectedTickets === 0 ? (
            <>
              <span className="num text-slate-400">{formatUsdc(price - remainder)}</span> of entries
              funds the first real ticket
            </>
          ) : (
            <>
              <span className="num text-slate-400">{projectedTickets}</span>{' '}
              {projectedTickets === 1 ? 'ticket' : 'tickets'} funded ·{' '}
              <span className="num">{pct.toFixed(0)}%</span> toward the next
            </>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Where the player stands on today's ladder, and what it is currently worth.
 *
 * Showing the projected ticket count next to the rank is the point: a rank on its
 * own is trivia, but "you are 6th, which is 1 ticket, and 12 points would make it
 * 2" is a reason to start another race.
 */
export function LadderStanding({
  rank,
  players,
  points,
  projectedTickets,
  pointsToNextRank,
  compact,
}: {
  rank: number | null;
  players: number;
  points: number;
  projectedTickets: number;
  pointsToNextRank: number | null;
  compact?: boolean;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="stat-label">Your standing</span>
        <span className="num text-sm text-slate-300">
          {rank ? (
            <>
              <span className="font-bold text-[var(--accent)]">#{rank}</span>
              <span className="text-slate-600"> of {players}</span>
            </>
          ) : (
            <span className="text-slate-600">unranked</span>
          )}
        </span>
      </div>

      <div className="flex items-end gap-4">
        <div>
          <div className="num text-3xl font-extrabold leading-none text-slate-100">
            {points.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">points today</div>
        </div>

        <div className="ml-auto text-right">
          <div
            className={`num text-3xl font-extrabold leading-none ${
              projectedTickets > 0 ? 'text-[var(--gold)]' : 'text-slate-600'
            }`}
          >
            {projectedTickets}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
            {projectedTickets === 1 ? 'ticket' : 'tickets'} projected
          </div>
        </div>
      </div>

      {!compact && (
        <p className="mt-3 text-xs text-slate-500">
          {rank === null ? (
            'Run one race to join today’s board.'
          ) : pointsToNextRank ? (
            <>
              <span className="num text-slate-400">{pointsToNextRank}</span> points would take you
              past #{rank - 1}
            </>
          ) : (
            <span className="text-[var(--accent)]">You&apos;re top of the board — hold it.</span>
          )}
        </p>
      )}
    </div>
  );
}
