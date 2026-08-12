/**
 * The vault day.
 *
 * Everything in this game is scored against a day, and the day is deliberately
 * pinned to Megapot's own cadence: the protocol draws once every 24 hours at
 * 17:00 UTC, so the ladder opens and closes at 17:00 UTC too. A day's entry fees
 * buy tickets for that day's ranking, and the reset lands on the draw — which is
 * also why a player who is having a bad afternoon always has a fresh board
 * coming, rather than a permanent all-time table they can never climb.
 *
 * Pure date arithmetic, no imports, safe on both client and server.
 */

/** Megapot draws daily at 17:00 UTC. The ladder rolls over with it. */
export const DAY_BOUNDARY_UTC_HOUR = 17;

export const DAY_MS = 24 * 60 * 60 * 1000;

const iso = (ms: number) => new Date(ms).toISOString();
const dateKey = (ms: number) => iso(ms).slice(0, 10);

/**
 * When the day containing `at` closes, as epoch ms.
 *
 * Before 17:00 UTC we are still inside the day that closes today; at or after
 * 17:00 UTC we have rolled into the day that closes tomorrow.
 */
export function dayCloseMs(at: number | Date = Date.now()): number {
  const d = new Date(at);
  const boundaryToday = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    DAY_BOUNDARY_UTC_HOUR,
  );
  return d.getTime() < boundaryToday ? boundaryToday : boundaryToday + DAY_MS;
}

/**
 * Stable identifier for the day containing `at`: the calendar date on which the
 * day closes, e.g. '2026-08-12'. Used as the ladder and pool key.
 */
export function vaultDayKey(at: number | Date = Date.now()): string {
  return dateKey(dayCloseMs(at));
}

export type DayWindow = {
  key: string;
  opensAt: string;
  closesAt: string;
  closesAtMs: number;
  opensAtMs: number;
};

export function dayWindow(at: number | Date = Date.now()): DayWindow {
  const closesAtMs = dayCloseMs(at);
  const opensAtMs = closesAtMs - DAY_MS;
  return {
    key: dateKey(closesAtMs),
    opensAt: iso(opensAtMs),
    closesAt: iso(closesAtMs),
    closesAtMs,
    opensAtMs,
  };
}

/** The window for a specific key, derived from the key alone. */
export function windowForKey(key: string): DayWindow {
  // A key is the closing date, so the close is that date at the boundary hour.
  const [y, m, d] = key.split('-').map(Number);
  const closesAtMs = Date.UTC(y, m - 1, d, DAY_BOUNDARY_UTC_HOUR);
  return {
    key,
    opensAt: iso(closesAtMs - DAY_MS),
    closesAt: iso(closesAtMs),
    closesAtMs,
    opensAtMs: closesAtMs - DAY_MS,
  };
}

export const msUntilClose = (at: number | Date = Date.now()) =>
  Math.max(0, dayCloseMs(at) - new Date(at).getTime());

/** True once the day identified by `key` is over and can be settled. */
export function isClosed(key: string, at: number | Date = Date.now()): boolean {
  return new Date(at).getTime() >= windowForKey(key).closesAtMs;
}
