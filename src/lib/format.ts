/**
 * Display formatting for money and time.
 *
 * USDC amounts arrive from the chain and the Data API as integer strings of
 * 6-decimal base units. They are formatted here by string arithmetic, never by
 * `Number()` — a float cannot represent these exactly, and this is the value that
 * decides how many real lottery tickets a day's play buys.
 */

export const USDC_DECIMALS = 6;

/** Split base units into whole and fractional parts without touching a float. */
function splitUnits(units: bigint, decimals = USDC_DECIMALS) {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  return {
    negative,
    whole: abs / scale,
    frac: (abs % scale).toString().padStart(decimals, '0'),
  };
}

/**
 * Format base units as a dollar string.
 *
 * `maxFraction` trims trailing zeros but keeps enough precision to distinguish
 * small testnet amounts — a $0.002 entry fee must not render as "$0.00".
 */
export function formatUsdc(
  units: bigint | string | number,
  opts: { maxFraction?: number; symbol?: boolean } = {},
): string {
  const { maxFraction = 6, symbol = true } = opts;
  const value = typeof units === 'bigint' ? units : BigInt(units ?? 0);
  const { negative, whole, frac } = splitUnits(value);

  // Keep at least 2 decimals, then extend only while digits are still significant.
  let end = 2;
  for (let i = frac.length - 1; i >= 2; i--) {
    if (frac[i] !== '0') { end = i + 1; break; }
  }
  const shown = frac.slice(0, Math.min(Math.max(end, 2), maxFraction));

  const body = `${whole.toLocaleString('en-US')}.${shown}`;
  return `${negative ? '-' : ''}${symbol ? '$' : ''}${body}`;
}

/** Compact form for big headline numbers: $1,102,228.53 -> $1.10M */
export function formatUsdcCompact(units: bigint | string | number): string {
  const value = typeof units === 'bigint' ? units : BigInt(units ?? 0);
  const dollars = value / 10n ** BigInt(USDC_DECIMALS);

  if (dollars >= 1_000_000n) return `$${(Number(dollars) / 1_000_000).toFixed(2)}M`;
  if (dollars >= 1_000n) return `$${(Number(dollars) / 1_000).toFixed(1)}K`;
  return formatUsdc(value, { maxFraction: 2 });
}

/** "3h 12m" / "12m 04s" / "24s" — a countdown that never shows a stale zero. */
export function formatDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

export const shortAddress = (a?: string | null) =>
  a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—';
