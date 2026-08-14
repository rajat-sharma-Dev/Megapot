'use client';

import { useMemo, useState } from 'react';
import { parseUnits } from 'viem';
import { useWallet } from '@/lib/wallet/useWallet';
import { useSound } from '@/lib/audio/SoundProvider';
import { formatUsdc } from '@/lib/format';

/**
 * Take your balance back out.
 *
 * Always available, always to the connected wallet and nowhere else. A game that
 * takes real deposits and has no exit is a game nobody should deposit into, so
 * this is a first-class panel and not a support ticket.
 *
 * The whole balance is withdrawable, including winnings a pot was too small to
 * turn into a ticket — those are refunded into it rather than held back.
 */
export function WithdrawPanel({
  creditsUnits,
  onWithdrawn,
  withdrawalsEnabled = true,
}: {
  creditsUnits: string;
  onWithdrawn: () => void;
  /**
   * False when no treasury is configured.
   *
   * Withdrawals are signed by the treasury key, so without one every attempt
   * throws server-side. The deposit panel already disabled itself in that case
   * and this one did not, which meant a fresh clone showed a working-looking
   * Withdraw button whose only possible outcome was an error — the exact
   * inconsistency that made "the deposit option is missing" the reported
   * symptom rather than "nothing is configured".
   */
  withdrawalsEnabled?: boolean;
}) {
  const w = useWallet();
  const { play } = useSound();

  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ units: string; url: string } | null>(null);

  const balance = BigInt(creditsUnits || '0');

  const parsed = useMemo(() => {
    if (!amount.trim()) return null;
    try {
      const units = parseUnits(amount.trim(), 6);
      return units > 0n ? units : null;
    } catch {
      return null;
    }
  }, [amount]);

  const overBalance = parsed !== null && parsed > balance;

  const submit = async () => {
    if (!parsed || !w.address) return;
    play('click');
    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: w.address, amountUnits: parsed.toString() }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? 'Withdrawal failed');

      setDone({ units: json.withdrawnUnits, url: json.explorerUrl });
      setAmount('');
      play('confirm');
      onWithdrawn();
      w.refetchUsdc();
    } catch (e) {
      setError((e as Error).message);
      play('error');
    } finally {
      setBusy(false);
    }
  };

  if (!withdrawalsEnabled) {
    return (
      <div>
        <div className="eyebrow">Withdraw</div>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Unavailable until a treasury wallet is configured — withdrawals are signed by its key.
          See the deposit panel above for the one-line fix.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="eyebrow">Withdraw</div>
        <button
          onClick={() => setAmount(formatUsdc(balance, { symbol: false }))}
          disabled={balance <= 0n}
          className="text-xs text-slate-500 transition-colors hover:text-slate-300 disabled:opacity-40"
        >
          max {formatUsdc(balance)}
        </button>
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
            aria-label="Withdrawal amount in USDC"
            className="num w-full rounded-xl border border-white/[0.09] bg-black/30 py-3 pl-7 pr-3 text-slate-100 outline-none transition-colors focus:border-[var(--cyan)]/60"
          />
        </div>
        <button
          onClick={submit}
          disabled={!parsed || overBalance || busy || balance <= 0n}
          className="btn btn-ghost px-6 py-3 text-sm"
        >
          {busy ? 'Sending…' : 'Withdraw'}
        </button>
      </div>

      <div className="mt-2 min-h-[18px] text-xs">
        {overBalance ? (
          <span className="text-[var(--danger)]">More than your balance.</span>
        ) : error ? (
          <span className="text-[var(--danger)]">{error}</span>
        ) : done ? (
          <span className="text-[var(--accent)]">
            ✓ {formatUsdc(done.units)} sent —{' '}
            <a href={done.url} target="_blank" rel="noreferrer" className="underline">
              view transaction
            </a>
          </span>
        ) : (
          <span className="text-slate-600">Goes back to the wallet you connected with.</span>
        )}
      </div>
    </div>
  );
}
