'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useWallet } from '@/lib/wallet/useWallet';
import { useSound } from '@/lib/audio/SoundProvider';
import { JACKPOT_CLAIM_ABI } from '@/lib/megapot/abi/client';
import { TARGET_CHAIN_ID } from '@/lib/wallet/config';
import { formatUsdc } from '@/lib/format';

type WinRow = {
  id: string;
  roundId: string;
  ticketId: string;
  normals: number[];
  bonusball: number;
  matchedNormals: number;
  bonusballMatch: boolean;
  amountFormatted: string;
  amount: { amount: string; decimals: number };
  claimed: boolean;
  claimedTxUrl: string | null;
  fromRallyVault: boolean;
};

type WinsResponse = {
  ok: boolean;
  claimableTicketIds: string[];
  unclaimedUnits: string;
  totalWonUnits: string;
  wins: WinRow[];
  jackpotAddress: `0x${string}`;
  apiError: string | null;
};

/**
 * Claim winnings.
 *
 * The other half of the lifecycle, and the half that is easy to forget to build:
 * buying a ticket is not the end of it. When a drawing settles, a winning ticket
 * has to be redeemed by calling `Jackpot.claimWinnings(ticketIds)`, which burns
 * the tickets and transfers the USDC.
 *
 * The player signs this, not the treasury, and that is not a limitation we
 * worked around — it is the correct shape. The ticket is an ERC-721 in their
 * wallet; a backend that could claim on their behalf would be a backend that
 * could redirect their winnings somewhere else.
 *
 * Renders nothing at all when there is nothing to claim, so it costs a player
 * with no wins exactly one line of vertical space: none.
 */
export function ClaimWinnings({ onClaimed }: { onClaimed?: () => void }) {
  const w = useWallet();
  const { play, engine } = useSound();

  const [data, setData] = useState<WinsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);

  const { writeContractAsync } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash ?? undefined,
    chainId: TARGET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  const load = useCallback(async () => {
    if (!w.address) return;
    try {
      const res = await fetch(`/api/wins?address=${w.address}`);
      const json = await res.json();
      if (json.ok) setData(json);
    } catch {
      // A wins board that can't load is not worth an error state — the player
      // has lost nothing and the tickets are still theirs on chain.
    }
  }, [w.address]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh once the claim confirms, so the row flips to claimed.
  useEffect(() => {
    if (!receipt) return;
    play('ticket');
    engine.duckMusic(2);
    setBusy(false);
    setTxHash(null);
    load();
    onClaimed?.();
  }, [receipt, load, play, engine, onClaimed]);

  const claim = async () => {
    if (!data?.claimableTicketIds.length) return;
    play('click');
    setBusy(true);
    setError(null);

    try {
      await w.ensureTargetChain();
      const hash = await writeContractAsync({
        address: data.jackpotAddress,
        abi: JACKPOT_CLAIM_ABI,
        functionName: 'claimWinnings',
        // The contract takes uint256[]; the API hands them back as strings.
        args: [data.claimableTicketIds.map((id) => BigInt(id))],
        chainId: TARGET_CHAIN_ID,
      });
      setTxHash(hash);
    } catch (e) {
      setBusy(false);
      const raw = (e as Error).message ?? '';
      setError(
        raw.toLowerCase().includes('user rejected')
          ? 'You cancelled the claim.'
          : raw.split('\n')[0],
      );
      play('error');
    }
  };

  const unclaimed = BigInt(data?.unclaimedUnits ?? '0');
  const wins = data?.wins ?? [];

  // Nothing won, nothing to say.
  if (!wins.length) return null;

  return (
    <div className="panel panel-lit panel-gold p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="chip chip-gold">Winnings</div>
        {unclaimed > 0n && (
          <span className="num text-sm font-bold text-[var(--gold)]">
            {formatUsdc(unclaimed)} unclaimed
          </span>
        )}
      </div>

      {unclaimed > 0n ? (
        <>
          <p className="text-sm leading-relaxed text-slate-400">
            {data!.claimableTicketIds.length} winning{' '}
            {data!.claimableTicketIds.length === 1 ? 'ticket' : 'tickets'} ready to redeem. You sign
            this yourself — the tickets are in your wallet, so nobody else can claim them.
          </p>
          <button
            onClick={claim}
            disabled={busy}
            className="btn btn-gold mt-4 w-full py-3.5 text-base"
          >
            {busy
              ? txHash
                ? 'Confirming…'
                : 'Sign in wallet…'
              : `Claim ${formatUsdc(unclaimed)}`}
          </button>
          {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
        </>
      ) : (
        <p className="text-sm text-slate-500">
          Everything you&apos;ve won has been claimed.
        </p>
      )}

      <div className="mt-5 space-y-2 border-t border-white/[0.07] pt-4">
        {wins.slice(0, 6).map((win) => (
          <div
            key={win.id}
            className="flex items-center gap-3 rounded-sm border border-white/[0.06] bg-white/[0.02] px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="num text-xs text-slate-300">
                {win.normals.join(' · ')}
                <span className="ml-2 text-[var(--gold)]">+{win.bonusball}</span>
              </div>
              <div className="text-[10px] text-slate-500">
                round {win.roundId} · matched {win.matchedNormals}
                {win.bonusballMatch && ' + bonusball'}
                {win.fromRallyVault && (
                  <span className="ml-1.5 text-[var(--accent)]">· won here</span>
                )}
              </div>
            </div>
            <span className="num text-sm font-bold text-[var(--gold)]">
              ${win.amountFormatted}
            </span>
            {win.claimed ? (
              win.claimedTxUrl ? (
                <a
                  href={win.claimedTxUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="chip text-[9px] hover:underline"
                >
                  claimed ↗
                </a>
              ) : (
                <span className="chip text-[9px]">claimed</span>
              )
            ) : (
              <span className="chip chip-gold text-[9px]">unclaimed</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
