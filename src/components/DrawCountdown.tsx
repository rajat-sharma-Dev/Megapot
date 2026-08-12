'use client';

import { useEffect, useState } from 'react';
import { formatDuration } from '@/lib/format';

/** Shared 1Hz clock so a page full of countdowns runs one interval, not eight. */
function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Countdown to the daily Megapot draw (17:00 UTC).
 *
 * This is a retention mechanic, not decoration: it converts the protocol's
 * cadence into a reason to play right now. Rendered client-side so it ticks.
 */
export function DrawCountdown({ drawTimeMs }: { drawTimeMs: number }) {
  const now = useNow();
  const remaining = Math.max(0, drawTimeMs - now);

  if (remaining === 0) {
    return <span className="tabular-nums text-amber-400">drawing now…</span>;
  }

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');

  return (
    <span className="tabular-nums">
      {h}h {pad(m)}m {pad(s)}s
    </span>
  );
}

/**
 * Countdown to the vault day closing — the moment the ladder pays out.
 *
 * Turns amber inside the last hour, because that is exactly when a player can
 * still change their rank and should feel the pressure to try.
 */
export function DayCountdown({
  closesAt,
  className = '',
}: {
  closesAt: string;
  className?: string;
}) {
  const now = useNow();
  const remaining = Math.max(0, new Date(closesAt).getTime() - now);

  if (remaining === 0) {
    return <span className={`tabular-nums text-amber-400 ${className}`}>settling…</span>;
  }

  const urgent = remaining < 3_600_000;

  return (
    <span className={`tabular-nums ${urgent ? 'text-[var(--gold)]' : ''} ${className}`}>
      {formatDuration(remaining)}
    </span>
  );
}
