'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { usePlayer, useJackpot } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { PointBankBar, CookieMeter } from '@/components/Progress';
import { TicketStrip } from '@/components/TicketStrip';
import { TICKET_THRESHOLD } from '@/lib/points/scoring';

type OnchainTickets = { data?: unknown[] } | null;

export default function ProfilePage() {
  const wallet = useWallet();
  const { profile } = usePlayer(wallet.address);
  const { jackpot } = useJackpot(60_000);
  const [onchain, setOnchain] = useState<OnchainTickets>(null);
  const [copied, setCopied] = useState(false);

  const explorerBase =
    jackpot?.network === 'mainnet' ? 'https://basescan.org' : 'https://sepolia.basescan.org';

  useEffect(() => {
    if (!wallet.address) return;
    fetch(`/api/tickets?address=${wallet.address}`)
      .then((r) => r.json())
      .then((j) => j.ok && setOnchain(j.onchain))
      .catch(() => {});
  }, [wallet.address]);

  const p = profile?.player;
  const tickets = profile?.tickets ?? [];

  return (
    <>
      <Nav address={wallet.address} name={wallet.name} />

      <main className="mx-auto max-w-4xl px-5 pb-24 pt-10">
        <h1
          className="text-3xl font-extrabold tracking-tight sm:text-4xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Your vault
        </h1>

        {/* ── Wallet ─────────────────────────────────────────────────── */}
        <div className="card mt-6 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="stat-label">Wallet</div>
              <div className="num mt-1 truncate text-lg font-bold text-slate-100">
                {wallet.address ?? '—'}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="chip">{wallet.isBurner ? 'Instant wallet' : 'Connected wallet'}</span>
                <span className="chip">
                  {jackpot?.network === 'mainnet' ? 'Base' : 'Base Sepolia'}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="btn btn-ghost px-4 py-2 text-sm"
                onClick={() => {
                  if (wallet.address) {
                    navigator.clipboard.writeText(wallet.address);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1600);
                  }
                }}
              >
                {copied ? 'Copied' : 'Copy address'}
              </button>
              {wallet.isBurner && (
                <button
                  className="btn btn-ghost px-4 py-2 text-sm"
                  onClick={() => wallet.connectInjected().catch((e) => alert(e.message))}
                >
                  Connect wallet
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Stats ──────────────────────────────────────────────────── */}
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div className="card space-y-6 p-6">
            <PointBankBar points={p?.pointBank ?? 0} threshold={TICKET_THRESHOLD} />
            <CookieMeter progress={(p?.cookiePieces ?? 0) % 6} />
          </div>

          <div className="card grid grid-cols-2 gap-5 p-6">
            <Stat label="Races" value={p?.racesCompleted ?? 0} />
            <Stat label="Lifetime points" value={p?.lifetimePoints ?? 0} />
            <Stat label="Steals landed" value={p?.totalStolen ?? 0} />
            <Stat label="Tickets earned" value={p?.ticketsEarned ?? 0} gold />
          </div>
        </div>

        {/* ── Tickets ────────────────────────────────────────────────── */}
        <section className="mt-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-xl font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              Megapot tickets
            </h2>
            <span className="text-sm text-slate-500">{tickets.length} minted</span>
          </div>

          {tickets.length === 0 ? (
            <div className="card p-10 text-center">
              <div className="text-3xl opacity-40">🎟️</div>
              <p className="mt-3 font-semibold text-slate-300">No tickets yet</p>
              <p className="mt-1 text-sm text-slate-500">
                Bank {TICKET_THRESHOLD} points, or finish 18 races for a Cookie.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {tickets.map((t) => (
                <div key={t.id} className="card p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className={`chip ${t.path === 'point_bank' ? 'chip-live' : 'chip-gold'}`}>
                      {t.path === 'point_bank' ? 'Point Bank · earned' : 'Cookie · random'}
                    </span>
                    <span className="num text-xs text-slate-500">
                      round {t.drawingId} · {new Date(t.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {t.normals.length > 0 ? (
                    <div className="flex justify-center py-2">
                      <TicketStrip
                        earned={t.earnedNormals}
                        filled={t.filledNormals}
                        bonusball={t.bonusball}
                        size="sm"
                      />
                    </div>
                  ) : (
                    <p className="py-2 text-center text-sm text-slate-500">
                      Protocol-random numbers — view them on Megapot.
                    </p>
                  )}

                  <a
                    href={`${explorerBase}/tx/${t.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num mt-3 block truncate text-center text-xs text-[var(--accent)] hover:underline"
                  >
                    {t.txHash} ↗
                  </a>
                </div>
              ))}
            </div>
          )}

          {onchain !== null && (
            <p className="mt-4 text-center text-xs text-slate-600">
              Megapot&apos;s Data API reports{' '}
              <span className="num text-slate-400">
                {Array.isArray((onchain as { data?: unknown[] })?.data)
                  ? (onchain as { data: unknown[] }).data.length
                  : 0}
              </span>{' '}
              ticket(s) for this wallet on {jackpot?.network === 'mainnet' ? 'Base' : 'Base Sepolia'}.
            </p>
          )}
        </section>
      </main>
    </>
  );
}

function Stat({ label, value, gold }: { label: string; value: number; gold?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        className={`num mt-1 text-3xl font-extrabold ${gold ? 'text-[var(--gold)]' : 'text-slate-100'}`}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}
