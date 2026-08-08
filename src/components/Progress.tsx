'use client';

import { COOKIE_PIECES } from '@/lib/points/scoring';

/** Point Bank progress toward the next ticket. */
export function PointBankBar({
  points,
  threshold,
  compact,
}: {
  points: number;
  threshold: number;
  compact?: boolean;
}) {
  const pct = Math.min(100, (points / threshold) * 100);
  const remaining = Math.max(0, threshold - points);

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="stat-label">Point Bank</span>
        <span className="num text-sm text-slate-300">
          <span className="font-bold text-[var(--accent)]">{points}</span>
          <span className="text-slate-600"> / {threshold}</span>
        </span>
      </div>

      <div className="relative h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #059669, #34d399)',
            boxShadow: '0 0 14px rgba(52,211,153,0.55)',
          }}
        />
      </div>

      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          {remaining === 0 ? (
            <span className="text-[var(--accent)]">Ticket ready — finish a race to mint it.</span>
          ) : (
            <>
              <span className="num text-slate-400">{remaining}</span> points to your next real ticket
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** The Cookie: the guaranteed path. Fills one piece every three races. */
export function CookieMeter({ progress, compact }: { progress: number; compact?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="stat-label">Cookie</span>
        <span className="num text-sm text-slate-300">
          <span className="font-bold text-[var(--gold)]">{progress}</span>
          <span className="text-slate-600"> / {COOKIE_PIECES} pieces</span>
        </span>
      </div>

      <div className="flex gap-1.5">
        {Array.from({ length: COOKIE_PIECES }, (_, i) => (
          <div
            key={i}
            className="h-2.5 flex-1 rounded-full transition-all duration-500"
            style={
              i < progress
                ? { background: 'linear-gradient(90deg,#f59e0b,#fbbf24)', boxShadow: '0 0 10px rgba(251,191,36,0.5)' }
                : { background: 'rgba(255,255,255,0.06)' }
            }
          />
        ))}
      </div>

      {!compact && (
        <p className="mt-2 text-xs text-slate-500">
          One piece every 3 races — a guaranteed ticket, win or lose.
        </p>
      )}
    </div>
  );
}
