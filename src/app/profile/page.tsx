'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/lib/wallet/useWallet';
import { usePlayer, useJackpot } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { LadderStanding } from '@/components/Progress';
import { DayCountdown } from '@/components/DrawCountdown';
import { formatUsdc } from '@/lib/format';

type OnchainTickets = { data?: unknown[] } | null;

export default function ProfilePage() {
  const wallet = useWallet();
  const { profile } = usePlayer(wallet.address);
  const { jackpot } = useJackpot(60_000);
  const [onchain, setOnchain] = useState<OnchainTickets>(null);
  const [onchainError, setOnchainError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const explorerBase =
    jackpot?.network === 'mainnet' ? 'https://basescan.org' : 'https://sepolia.basescan.org';

  useEffect(() => {
    if (!wallet.address) return;
    fetch(`/api/tickets?address=${wallet.address}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) return;
        setOnchain(j.onchain);
        setOnchainError(j.onchainError ?? null);
      })
      .catch(() => {});
  }, [wallet.address]);

  const p = profile?.player;
  const tickets = profile?.tickets ?? [];
  const totalTickets = tickets.reduce((s, t) => s + t.count, 0);
  const onchainCount = Array.isArray(onchain?.data) ? onchain!.data!.length : null;

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
        <div className="card mt-6 p-6 rise">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="stat-label">Wallet</div>
              <div className="num mt-1 truncate text-lg font-bold text-slate-100">
                {wallet.address ?? '—'}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="chip">{wallet.isBurner ? 'Instant wallet' : 'Connected wallet'}</span>
                <span className="chip">
                  {jackpot?.network === 'mainnet' ? 'Base' : 'Base Sepolia'}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!wallet.address) return;
                  navigator.clipboard?.writeText(wallet.address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }}
                className="btn btn-ghost px-4 py-2.5 text-sm"
              >
                {copied ? 'Copied' : 'Copy address'}
              </button>
              {wallet.address && (
                <a
                  href={`${explorerBase}/address/${wallet.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost px-4 py-2.5 text-sm"
                >
                  Basescan ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* ── Today ──────────────────────────────────────────────────── */}
        {profile && (
          <div className="card mt-5 p-6 rise" style={{ animationDelay: '60ms' }}>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div className="chip chip-live">Today</div>
              <div className="text-xs text-slate-500">
                resets in <DayCountdown closesAt={profile.today.closesAt} className="font-bold" />
              </div>
            </div>

            <LadderStanding
              rank={profile.today.rank}
              players={profile.today.players}
              points={profile.today.points}
              projectedTickets={profile.today.projectedTickets}
              pointsToNextRank={profile.today.pointsToNextRank}
            />

            <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-5 sm:grid-cols-4">
              <Stat label="Races today" value={profile.today.races} />
              <Stat label="Best run today" value={profile.today.bestScore} />
              <Stat
                label="Entries left"
                value={profile.credits.entriesAffordable}
                hint={`${formatUsdc(profile.credits.units)} credit`}
              />
              <Stat
                label="Free / day"
                value={profile.credits.freeEntriesPerDay}
                hint={`${formatUsdc(profile.credits.entryFeeUnits)} each`}
              />
            </div>
          </div>
        )}

        {/* ── Lifetime ───────────────────────────────────────────────── */}
        <div className="card mt-5 grid grid-cols-2 gap-5 p-6 sm:grid-cols-4 rise" style={{ animationDelay: '120ms' }}>
          <Stat label="Lifetime points" value={p?.lifetimePoints ?? 0} />
          <Stat label="Races" value={p?.racesCompleted ?? 0} hint={p?.racesRetired ? `${p.racesRetired} DNF` : undefined} />
          <Stat label="Best run" value={p?.bestRaceScore ?? 0} />
          <Stat label="Steals landed" value={p?.totalStolen ?? 0} />
        </div>

        {/* ── Tickets ────────────────────────────────────────────────── */}
        <section className="mt-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-xl font-bold text-slate-100" style={{ fontFamily: 'var(--font-display)' }}>
              Megapot tickets won
            </h2>
            <div className="flex items-center gap-2">
              <span className="chip chip-gold">{totalTickets} total</span>
              {onchainCount !== null && (
                <span className="chip" title="Megapot's own view of this wallet">
                  {onchainCount} on-chain
                </span>
              )}
            </div>
          </div>

          {onchainError && (
            <p className="mt-2 text-xs text-slate-600">
              Megapot&apos;s Data API was unreachable for the cross-check: {onchainError}
            </p>
          )}

          {tickets.length === 0 ? (
            <div className="card mt-4 p-10 text-center">
              <p className="text-sm text-slate-500">
                No tickets yet. Tickets are minted when the vault day closes at 17:00 UTC — finish
                high enough on the ladder and they land straight in this wallet.
              </p>
              <Link href="/race" className="btn btn-primary mt-5 px-6 py-3">
                Climb the ladder
              </Link>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {tickets.map((t) => (
                <div key={t.id} className="card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="chip chip-gold">
                        {t.count} {t.count === 1 ? 'ticket' : 'tickets'}
                      </span>
                      <span className="chip">rank #{t.rank}</span>
                      <span className="chip">
                        {t.points.toLocaleString()} pts
                      </span>
                    </div>
                    <div className="num text-xs text-slate-500">
                      day {t.dayKey} · round {t.drawingId}
                    </div>
                  </div>

                  <a
                    href={`${explorerBase}/tx/${t.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num mt-3 block truncate text-xs text-[var(--accent)] hover:underline"
                  >
                    {t.txHash} ↗
                  </a>

                  <p className="mt-2 text-xs text-slate-600">
                    Numbers were drawn by the protocol at mint time via
                    JackpotRandomTicketBuyer — the ticket is an ERC-721 held by this wallet.
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function Stat({
  label, value, hint,
}: { label: string; value: number | string; hint?: string }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="num mt-1 text-2xl font-extrabold text-slate-100">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {hint && <div className="num mt-0.5 text-[11px] text-slate-600">{hint}</div>}
    </div>
  );
}
