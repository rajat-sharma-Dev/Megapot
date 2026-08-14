'use client';

import { formatUsdc } from '@/lib/format';

/**
 * The pot for the race in front of you.
 *
 * Shown as seats rather than as money, because "four of five seats are staked"
 * is the fact that decides whether a win completes a whole ticket.
 */
export function PotMeter({
  potUnits,
  entryFeeUnits,
  stakedSeats,
  seatsTotal,
  compact,
}: {
  potUnits: string;
  entryFeeUnits: string;
  stakedSeats: number;
  seatsTotal: number;
  compact?: boolean;
}) {
  const pot = BigInt(potUnits || '0');
  const fee = BigInt(entryFeeUnits || '0');
  const pct = seatsTotal > 0 ? (stakedSeats / seatsTotal) * 100 : 0;
  const full = stakedSeats >= seatsTotal;

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="stat-label">Pot on the line</span>
        <span className="num text-xs text-slate-500">
          {stakedSeats}/{seatsTotal} seats staked
        </span>
      </div>

      <div className="flex items-center gap-3">
        <div className="num shrink-0 text-2xl font-bold text-[var(--gold)]">
          {formatUsdc(pot)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="bar-grow h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background: full
                  ? 'linear-gradient(90deg, var(--gold-deep), #ffe08a)'
                  : 'linear-gradient(90deg, var(--gold-deep), var(--gold))',
                boxShadow: '0 0 14px rgba(255,197,61,0.55)',
              }}
            />
          </div>
        </div>
      </div>

      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          {full ? (
            <span className="text-[var(--gold)]">
              Full house — the winner takes a whole ticket immediately.
            </span>
          ) : (
            <>
              <span className="num text-slate-400">{formatUsdc(fee)}</span> per seat ·{' '}
              winner takes all {stakedSeats} stakes
            </>
          )}
        </p>
      )}
    </div>
  );
}
