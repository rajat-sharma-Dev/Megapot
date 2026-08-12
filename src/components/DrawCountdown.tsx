'use client';

import { useNow } from '@/lib/hooks';
import { formatDuration } from '@/lib/format';

/**
 * Countdown to the daily Megapot draw.
 *
 * A retention mechanic rather than decoration: it converts the protocol's
 * once-a-day cadence into a reason to play a race right now, because a ticket
 * won after the draw closes rides the next one.
 */
export function DrawCountdown({ drawTimeMs }: { drawTimeMs: number }) {
  const now = useNow();
  const remaining = Math.max(0, drawTimeMs - now);

  if (remaining === 0) {
    return <span className="num text-[var(--gold)]">drawing now…</span>;
  }

  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  const urgent = remaining < 1_800_000;

  return (
    <span className={`num ${urgent ? 'text-[var(--gold)]' : ''}`}>
      {h}h {pad(m)}m {pad(s)}s
    </span>
  );
}

/**
 * A generic deadline countdown — used for the matchmaking fill window and the
 * submission deadline. Sub-minute precision, because both of those are measured
 * in seconds and "1m" would be a lie for 61 seconds and for 119.
 */
export function Countdown({
  until,
  className = '',
  onDone,
}: {
  until: string | number;
  className?: string;
  onDone?: () => void;
}) {
  const now = useNow(250);
  const target = typeof until === 'number' ? until : new Date(until).getTime();
  const remaining = Math.max(0, target - now);

  if (remaining === 0) {
    onDone?.();
    return <span className={`num ${className}`}>now</span>;
  }

  return <span className={`num ${className}`}>{formatDuration(remaining)}</span>;
}
