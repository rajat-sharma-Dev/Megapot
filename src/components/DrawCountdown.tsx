'use client';

import { useEffect, useState } from 'react';

/**
 * Countdown to the daily Megapot draw (17:00 UTC on mainnet).
 *
 * This is a retention mechanic, not decoration: it converts the protocol's
 * cadence into a reason to play right now — "earn a ticket before the draw
 * closes." Rendered client-side so it ticks.
 */
export function DrawCountdown({ drawTimeMs }: { drawTimeMs: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, drawTimeMs - now);
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  const s = Math.floor((remaining % 60_000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');

  if (remaining === 0) {
    return <span className="tabular-nums text-amber-400">drawing now…</span>;
  }

  return (
    <span className="tabular-nums">
      {h}h {pad(m)}m {pad(s)}s
    </span>
  );
}
