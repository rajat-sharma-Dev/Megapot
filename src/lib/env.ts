/**
 * Reading environment variables that came from a `.env` file by way of a
 * dashboard.
 *
 * dotenv strips surrounding quotes; almost nothing else does. `vercel env add`
 * is fed a raw value and stores it byte-for-byte, so a line that reads
 * `FOO="bar"` locally becomes the six-character value `"bar"` in production —
 * the same file, meaning two different things depending on who parsed it.
 *
 * That difference is invisible until it isn't. In this app it silently turned
 * `MEGAPOT_DRY_RUN="false"` into dry-run mode (`"false" !== 'false'`), which
 * mints *simulated* lottery tickets — a failure that looks exactly like success
 * right up until someone checks the chain for a ticket that was never bought.
 *
 * So: every env read goes through here, and comparisons are made against the
 * cleaned value rather than the raw one.
 */

/** A trimmed env value with surrounding quotes removed. Empty string → undefined. */
export function envStr(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const v = raw.trim().replace(/^["']|["']$/g, '').trim();
  return v === '' ? undefined : v;
}

/**
 * A boolean env flag.
 *
 * Requires an explicit, recognised value — anything unrecognised falls back to
 * `fallback` rather than being coerced. A flag this important should never be
 * decided by the truthiness of a typo.
 */
export function envBool(raw: string | undefined, fallback: boolean): boolean {
  const v = envStr(raw)?.toLowerCase();
  if (v === undefined) return fallback;
  if (v === 'true' || v === '1' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'no') return false;
  return fallback;
}
