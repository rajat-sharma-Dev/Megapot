/**
 * Unclaimed deposits.
 *
 * A deposit is two independent steps: USDC moves on chain, and then the server
 * is told to go and look at it. Only the first one is irreversible, and the
 * second one is an ordinary HTTP request that can fail for entirely ordinary
 * reasons — a dropped connection, a dev server recompiling, a closed tab.
 *
 * When that happens the money is not lost. It is sitting in the treasury with a
 * transaction hash proving where it came from, and `/api/deposit` will credit it
 * whenever it is next asked, because verification reads the chain and is
 * idempotent on the hash. What was missing was anything that ever asked again.
 *
 * So the hash is written to localStorage the instant it exists — before the
 * receipt, before anything can fail — and stays there until the server confirms
 * the credit. Every mount retries whatever it finds.
 */

export type PendingDeposit = {
  txHash: `0x${string}`;
  /** Base units, as sent. Display only — the server never trusts this. */
  amountUnits: string;
  createdAt: number;
};

const KEY = (address: string) => `rally_pending_deposit_${address.toLowerCase()}`;

export function readPending(address: string): PendingDeposit | null {
  try {
    const raw = localStorage.getItem(KEY(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingDeposit;
    return /^0x[a-fA-F0-9]{64}$/.test(parsed?.txHash ?? '') ? parsed : null;
  } catch {
    return null;
  }
}

export function writePending(address: string, pending: PendingDeposit): void {
  try {
    localStorage.setItem(KEY(address), JSON.stringify(pending));
  } catch {
    // Storage disabled. The in-page retry still works; only a reload loses it.
  }
}

export function clearPending(address: string): void {
  try {
    localStorage.removeItem(KEY(address));
  } catch {
    // Nothing to do.
  }
}

/**
 * Is this failure worth retrying?
 *
 * Network failures always are — that is the case this whole module exists for.
 * So are the server's own "not yet" answers, because a transaction that hasn't
 * propagated or confirmed will confirm shortly.
 *
 * Everything else is the server telling us this hash will never be a valid
 * deposit, and retrying it forever would leave a permanent error banner over a
 * transaction that was never ours.
 */
export function isTransientDepositError(message: string): boolean {
  const m = message.toLowerCase();
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed')) {
    return true;
  }
  return (
    m.includes('not on chain yet') ||
    m.includes('another confirmation') ||
    m.includes('timeout') ||
    m.includes('econnrefused') ||
    m.includes('fetch failed')
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CreditResult = {
  creditedUnits: string;
  creditsUnits: string;
  alreadyCredited: boolean;
  txHash: string;
  explorerUrl: string;
};

/**
 * Ask the server to credit a deposit, retrying through transient failures.
 *
 * Backs off 1s, 2s, 4s, 8s, 16s — long enough to ride out a restarting dev
 * server or a slow RPC, short enough that a player watching the screen sees it
 * resolve rather than giving up on it.
 */
export async function creditDeposit(
  address: string,
  txHash: string,
  opts: { attempts?: number; onAttempt?: (n: number) => void } = {},
): Promise<CreditResult> {
  const attempts = opts.attempts ?? 5;
  let lastError = 'Could not reach the server to credit that deposit.';

  for (let i = 0; i < attempts; i++) {
    opts.onAttempt?.(i + 1);
    try {
      const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, txHash }),
      });
      const json = await res.json();

      if (json?.ok) return json as CreditResult;

      lastError = json?.error ?? `Server returned ${res.status}`;
      if (!isTransientDepositError(lastError)) throw new Error(lastError);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      // A thrown non-transient server error must not be swallowed by the retry.
      if (!isTransientDepositError(message)) throw new Error(message);
      lastError = message;
    }

    if (i < attempts - 1) await sleep(1000 * 2 ** i);
  }

  throw new Error(lastError);
}
