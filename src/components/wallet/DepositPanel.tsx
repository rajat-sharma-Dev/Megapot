'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseUnits } from 'viem';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useWallet } from '@/lib/wallet/useWallet';
import { useSound } from '@/lib/audio/SoundProvider';
import { ERC20_MINIMAL_ABI } from '@/lib/wallet/erc20';
import { TARGET_CHAIN_ID, FAUCET_URL } from '@/lib/wallet/config';
import {
  creditDeposit, readPending, writePending, clearPending, type PendingDeposit,
} from '@/lib/wallet/pendingDeposit';
import { formatUsdc } from '@/lib/format';
import type { Jackpot } from '@/lib/hooks';

type Phase = 'idle' | 'signing' | 'confirming' | 'crediting' | 'done' | 'error';

/**
 * Deposit real USDC.
 *
 * The player signs an ordinary ERC-20 transfer to the treasury from their own
 * wallet — no approval dance, no custom contract, nothing to audit. Once it
 * confirms we hand the hash to the server, which reads the receipt off chain and
 * credits exactly what actually moved. The client never sends an amount; the
 * transfer is the source of truth and the client's opinion about it is not.
 *
 * The transfer and the credit are separate steps, and only the first is
 * irreversible — so the hash is persisted the moment it exists and retried until
 * the server confirms. A failed credit is a delay, never a loss.
 */
export function DepositPanel({
  jackpot,
  onCredited,
}: {
  jackpot: Jackpot | null;
  onCredited: () => void;
}) {
  const w = useWallet();
  const { play } = useSound();

  const [amount, setAmount] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [credited, setCredited] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingDeposit | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recovering, setRecovering] = useState(false);
  const [manualHash, setManualHash] = useState('');
  const [showManual, setShowManual] = useState(false);

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const { data: receipt, isError: receiptFailed } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  const entryFee = jackpot ? BigInt(jackpot.economy.entryFeeUnits) : 0n;
  const minDeposit = jackpot ? BigInt(jackpot.economy.minDepositUnits) : 0n;

  /** Presets in ENTRIES, not dollars — an entry costs $0.20 on Base and $0.002
   * on Sepolia, and "10 races" means the same thing on both. */
  const presets = useMemo(
    () => [5, 10, 25, 50].map((n) => ({ races: n, units: entryFee * BigInt(n) })),
    [entryFee],
  );

  const parsed = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      const units = parseUnits(amount.trim(), 6);
      return units > 0n ? units : null;
    } catch {
      return null;
    }
  }, [amount]);

  const tooSmall = parsed !== null && minDeposit > 0n && parsed < minDeposit;
  const overBalance = parsed !== null && w.usdcBalance !== null && parsed > w.usdcBalance;

  // ── Crediting ────────────────────────────────────────────────────────────

  const settle = useCallback(
    async (hash: string, { silent = false } = {}) => {
      if (!w.address) return;
      setAttempt(0);
      try {
        const result = await creditDeposit(w.address, hash, { onAttempt: setAttempt });
        clearPending(w.address);
        setPending(null);
        setCredited(result.creditedUnits);
        setPhase('done');
        setMessage(null);
        setAmount('');
        setTxHash(null);
        if (!silent) play('ticket');
        onCredited();
        w.refetchUsdc();
      } catch (e) {
        setPhase('error');
        setMessage((e as Error).message);
        if (!silent) play('error');
      } finally {
        setAttempt(0);
      }
    },
    [w, play, onCredited],
  );

  /**
   * `settle` closes over most of this component, so it has a new identity on
   * every render. Effects therefore reach it through a ref instead of depending
   * on it — a `settle` dependency would re-run them constantly, and the mount
   * effect below calls `setPending` with a freshly-parsed object each time,
   * which is a render loop rather than merely wasteful.
   */
  const settleRef = useRef(settle);
  useEffect(() => {
    settleRef.current = settle;
  });

  /**
   * Pick up anything left unclaimed by a previous session.
   *
   * This is what turns "Failed to fetch" from a lost deposit into a two-second
   * delay: the hash is written before the transfer is even confirmed, so a
   * reload, a crash or a closed tab all recover on the next visit.
   */
  const claimedOnMount = useRef<string | null>(null);
  const address = w.address;
  useEffect(() => {
    if (!address) return;
    const found = readPending(address);
    if (!found || claimedOnMount.current === found.txHash) return;
    claimedOnMount.current = found.txHash;

    setPending(found);
    setRecovering(true);
    settleRef.current(found.txHash, { silent: true }).finally(() => setRecovering(false));
  }, [address]);

  // Once the transfer confirms, tell the server to go and look at it.
  useEffect(() => {
    if (!receipt || phase !== 'confirming' || !txHash) return;
    setPhase('crediting');
    settleRef.current(txHash);
  }, [receipt, phase, txHash]);

  useEffect(() => {
    if (receiptFailed && phase === 'confirming') {
      setPhase('error');
      setMessage('That transaction failed on chain. Nothing was deposited.');
      if (w.address) clearPending(w.address);
      setPending(null);
    }
  }, [receiptFailed, phase, w.address]);

  // ── Sending ──────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!parsed || !w.address || !jackpot?.treasuryAddress) return;
    play('click');
    setPhase('signing');
    setMessage(null);
    setCredited(null);

    try {
      // Awaited, not fired-and-hoped: a network switch is a wallet prompt the
      // user can take seconds to answer, and not waiting for it is what produces
      // a ChainMismatchError on the very next line.
      await w.ensureTargetChain();

      const hash = await writeContractAsync({
        address: jackpot.usdcAddress,
        abi: ERC20_MINIMAL_ABI,
        functionName: 'transfer',
        args: [jackpot.treasuryAddress, parsed],
        chainId: TARGET_CHAIN_ID,
      });

      // Recorded BEFORE waiting for the receipt. From here on the deposit is
      // recoverable no matter what happens to this page.
      const record: PendingDeposit = {
        txHash: hash,
        amountUnits: parsed.toString(),
        createdAt: Date.now(),
      };
      writePending(w.address, record);
      setPending(record);

      setTxHash(hash);
      setPhase('confirming');
    } catch (e) {
      setPhase('error');
      const raw = (e as Error).message ?? '';
      setMessage(friendlyError(raw, w.chainLabel));
      play('error');
    }
  };

  const claimManual = async () => {
    const hash = manualHash.trim();
    if (!/^0x[a-fA-F0-9]{64}$/.test(hash)) {
      setPhase('error');
      setMessage('That is not a valid transaction hash.');
      return;
    }
    setPhase('crediting');
    setMessage(null);
    await settle(hash);
    setManualHash('');
  };

  if (!jackpot?.depositsEnabled) {
    return (
      <div className="inset p-5">
        <div className="eyebrow">Deposits</div>
        <p className="mt-2 text-sm text-slate-400">
          This deployment has no treasury address configured, so deposits are switched off. Set{' '}
          <span className="num text-slate-300">TREASURY_PRIVATE_KEY</span> to enable them.
        </p>
      </div>
    );
  }

  const busy =
    phase === 'signing' || phase === 'confirming' || phase === 'crediting' || recovering;

  return (
    <div>
      {/* ── Unclaimed deposit banner ─────────────────────────────────── */}
      {pending && (
        <div className="mb-4 rounded-xl border border-[var(--gold)]/35 bg-[var(--gold)]/[0.07] p-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 text-base">⏳</span>
            <div className="min-w-0 flex-1">
              <div className="display text-sm font-semibold text-[var(--gold)]">
                {recovering || phase === 'crediting'
                  ? `Crediting your deposit…${attempt > 1 ? ` (attempt ${attempt})` : ''}`
                  : 'You have a deposit waiting to be credited'}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">
                {formatUsdc(pending.amountUnits)} left your wallet. The transfer is on chain and
                safe — only the confirmation to our server is outstanding.
              </p>
              <div className="num mt-1 truncate text-[10px] text-slate-600">{pending.txHash}</div>
            </div>
            {!recovering && phase !== 'crediting' && (
              <button
                onClick={() => settle(pending.txHash)}
                className="btn btn-gold shrink-0 px-3 py-1.5 text-xs"
              >
                Retry
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Deposit USDC</div>
        <div className="num text-xs text-slate-500">
          in wallet{' '}
          <span className="text-slate-300">
            {w.usdcBalance !== null ? formatUsdc(w.usdcBalance) : '—'}
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {presets.map((p) => (
          <button
            key={p.races}
            onClick={() => {
              play('hover');
              setAmount(formatUsdc(p.units, { symbol: false }));
            }}
            className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-2 py-2 text-center transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent)]/[0.06]"
          >
            <div className="num text-sm font-bold text-slate-200">{p.races}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">races</div>
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <div className="relative flex-1">
          <span className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
            $
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
            inputMode="decimal"
            placeholder="0.00"
            aria-label="Deposit amount in USDC"
            className="num w-full rounded-xl border border-white/[0.09] bg-black/30 py-3 pl-7 pr-3 text-slate-100 outline-none transition-colors focus:border-[var(--accent)]/60"
          />
        </div>
        <button
          onClick={submit}
          disabled={!parsed || tooSmall || overBalance || busy}
          className="btn btn-primary px-6 py-3 text-sm"
        >
          {phase === 'signing'
            ? 'Sign in wallet…'
            : phase === 'confirming'
              ? 'Confirming…'
              : phase === 'crediting'
                ? 'Crediting…'
                : w.wrongNetwork
                  ? `Switch & deposit`
                  : 'Deposit'}
        </button>
      </div>

      <div className="mt-2 min-h-[18px] text-xs">
        {tooSmall ? (
          <span className="text-[var(--danger)]">
            Minimum deposit is {formatUsdc(minDeposit)} — five entries.
          </span>
        ) : overBalance ? (
          <span className="text-[var(--danger)]">That&apos;s more USDC than your wallet holds.</span>
        ) : phase === 'error' && message ? (
          <span className="text-[var(--danger)]">{message}</span>
        ) : phase === 'done' && credited ? (
          <span className="text-[var(--accent)]">
            ✓ {formatUsdc(credited)} credited —{' '}
            {entryFee > 0n ? Number(BigInt(credited) / entryFee) : 0} entries added.
          </span>
        ) : w.wrongNetwork ? (
          <span className="text-[var(--gold)]">
            Your wallet is on another network — depositing will ask you to switch to{' '}
            {w.chainLabel}.
          </span>
        ) : parsed && entryFee > 0n ? (
          <span className="text-slate-500">
            Buys <span className="num text-slate-300">{Number(parsed / entryFee)}</span> race
            entries.
          </span>
        ) : (
          <span className="text-slate-600">
            Sent straight from your wallet — a plain USDC transfer, no approvals.
          </span>
        )}
      </div>

      {w.gasBalance === 0n && (
        <p className="mt-2 text-xs text-[var(--gold)]">
          Your wallet has no {w.targetChain.nativeCurrency.symbol} for gas, so this transfer
          can&apos;t be sent yet.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <a
          href={FAUCET_URL}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Need test USDC on {w.chainLabel}? →
        </a>
        <button
          onClick={() => setShowManual((v) => !v)}
          className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
        >
          Deposit not showing up?
        </button>
      </div>

      {/*
        Manual recovery.

        Crediting reads the chain and only counts USDC transfers FROM this wallet
        TO the treasury, and it is idempotent on the hash — so letting anyone
        paste any hash here is safe. It cannot credit a stranger's transfer and it
        cannot credit the same one twice.
      */}
      {showManual && (
        <div className="inset mt-3 p-4">
          <div className="stat-label">Credit a deposit by transaction hash</div>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
            If a transfer went through but never showed up, paste its hash. We&apos;ll read the
            receipt off chain and credit exactly what moved. Safe to run twice — a deposit can only
            ever be credited once.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              value={manualHash}
              onChange={(e) => setManualHash(e.target.value.trim())}
              placeholder="0x…"
              aria-label="Deposit transaction hash"
              className="num min-w-0 flex-1 rounded-xl border border-white/[0.09] bg-black/30 px-3 py-2.5 text-xs text-slate-100 outline-none transition-colors focus:border-[var(--accent)]/60"
            />
            <button
              onClick={claimManual}
              disabled={busy || !manualHash}
              className="btn btn-ghost px-4 py-2.5 text-xs"
            >
              Credit it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Turn wallet and RPC noise into something a player can act on. */
function friendlyError(raw: string, chainLabel: string): string {
  const m = raw.toLowerCase();
  if (m.includes('user rejected') || m.includes('user denied')) {
    return 'You cancelled the transaction.';
  }
  if (m.includes('does not match the target chain') || m.includes('chain mismatch')) {
    return `Your wallet is on the wrong network. Switch it to ${chainLabel} and try again.`;
  }
  if (m.includes('insufficient funds')) {
    return `Not enough ${chainLabel} gas in your wallet to send this transfer.`;
  }
  return raw.split('\n')[0];
}
