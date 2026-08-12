'use client';

import Link from 'next/link';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer, useLeaderboard } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { JackpotPanel } from '@/components/JackpotPanel';
import { PoolMeter, LadderStanding } from '@/components/Progress';
import { DayCountdown } from '@/components/DrawCountdown';
import { formatUsdc } from '@/lib/format';

export default function Hub() {
  const wallet = useWallet();
  const { jackpot, error } = useJackpot();
  const { profile } = usePlayer(wallet.address);
  const { board } = useLeaderboard(20_000);

  const day = board?.day;
  const top = board?.today.slice(0, 5) ?? [];

  return (
    <>
      <Nav address={wallet.address} name={wallet.name} />

      <main className="mx-auto max-w-6xl px-5 pb-24 pt-12">
        {/* ── Hero ───────────────────────────────────────────────────── */}
        <section className="rise">
          <div className="chip chip-live mb-5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
            Megapot Prize Track · Summer Game Jam 2026
          </div>

          <h1
            className="max-w-3xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Race for the pot.
            <br />
            <span className="text-[var(--accent)]">Climb for the ticket.</span>
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-400">
            Five racers, a track built fresh every time, and a boost tank you have to keep
            refuelling. Every entry fee is pooled — and when the day closes, the pool buys real
            Megapot tickets and hands them to the top of the leaderboard.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/race" className="btn btn-primary px-7 py-3.5 text-base">
              Race now
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link href="/leaderboard" className="btn btn-ghost px-6 py-3.5 text-base">
              Today&apos;s ladder
            </Link>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            No signup. A wallet is created for you the moment you land here, and your first{' '}
            {profile?.credits.freeEntriesPerDay ?? 25} entries a day are free.
          </p>
        </section>

        {/* ── The clock, the pool, your standing ─────────────────────── */}
        {day && (
          <section className="mt-12">
            <div className="card relative overflow-hidden p-6 rise">
              <div className="absolute inset-x-0 top-0 h-px shimmer" />
              <div className="grid gap-6 lg:grid-cols-3">
                <div>
                  <div className="stat-label">Ladder resets in</div>
                  <div
                    className="num mt-1.5 text-4xl font-extrabold"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    <DayCountdown closesAt={day.closesAt} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    17:00 UTC — the same moment Megapot draws. Board wipes, everyone starts level.
                  </p>
                </div>

                <PoolMeter
                  poolUnits={day.poolUnits}
                  ticketPriceUnits={day.ticketPriceUnits}
                  projectedTickets={day.projectedTickets}
                  entries={day.entries}
                />

                <LadderStanding
                  rank={profile?.today.rank ?? null}
                  players={profile?.today.players ?? 0}
                  points={profile?.today.points ?? 0}
                  projectedTickets={profile?.today.projectedTickets ?? 0}
                  pointsToNextRank={profile?.today.pointsToNextRank ?? null}
                />
              </div>
            </div>
          </section>
        )}

        {/* ── Live state + top of the board ──────────────────────────── */}
        <section className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <JackpotPanel jackpot={jackpot} error={error} />

          <div className="card p-6">
            <div className="mb-5 flex items-center justify-between">
              <div className="chip chip-live">Top of the ladder</div>
              <Link href="/leaderboard" className="text-xs text-slate-500 hover:text-slate-300">
                full board →
              </Link>
            </div>

            {top.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                Nobody has raced today yet. First run takes the top spot.
              </p>
            ) : (
              <div className="stagger space-y-2">
                {top.map((row) => (
                  <div
                    key={row.address}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                      row.address === wallet.address?.toLowerCase()
                        ? 'you-row border-[var(--accent)]/40 bg-[var(--accent)]/[0.06]'
                        : 'border-white/[0.07] bg-white/[0.02]'
                    }`}
                  >
                    <span className="num w-6 text-sm font-bold text-slate-500">{row.rank}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-200">
                      {row.name}
                    </span>
                    <span className="num text-sm font-bold text-slate-100">
                      {row.points.toLocaleString()}
                    </span>
                    {row.projectedTickets > 0 && (
                      <span className="chip chip-gold">{row.projectedTickets} 🎟</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-5">
              <Stat label="Races" value={profile?.player.racesCompleted ?? 0} />
              <Stat label="Best run" value={profile?.player.bestRaceScore ?? 0} />
              <Stat label="Tickets won" value={profile?.player.ticketsEarned ?? 0} accent />
            </div>
          </div>
        </section>

        {/* ── The mechanic, explained ────────────────────────────────── */}
        <section className="mt-14">
          <div className="card overflow-hidden p-7">
            <div className="chip chip-gold mb-5">How it works</div>
            <h2
              className="text-2xl font-bold tracking-tight sm:text-3xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Five entries buy one real ticket
            </h2>
            <p className="mt-3 max-w-2xl text-slate-400">
              A Megapot ticket costs{' '}
              <span className="num font-semibold text-slate-200">
                {day ? formatUsdc(day.ticketPriceUnits) : '—'}
              </span>
              , so an entry costs a fifth of that —{' '}
              <span className="num font-semibold text-[var(--cyan)]">
                {day ? formatUsdc(day.entryFeeUnits) : '—'}
              </span>
              . Nobody can buy an advantage: every entry costs the same and buys the same thing,
              a chance to score. Rank is the only lever, and rank is earned by driving.
            </p>

            <div className="mt-7 grid gap-4 sm:grid-cols-4">
              <Step n="01" title="Enter" body="A fifth of a ticket, straight into today's shared pool." />
              <Step n="02" title="Race" body="Collect point cells, grab fuel cans, hold boost to recover from hits and close gaps." />
              <Step n="03" title="Climb" body="Points stack up on today's ladder. Play as many races as you like — only your total matters." />
              <Step n="04" title="Collect" body="At 17:00 UTC the pool buys tickets and mints them to the top of the board. Higher rank, more tickets." />
            </div>

            <div className="mt-7 rounded-2xl border border-white/[0.07] bg-black/25 p-6">
              <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                Why race instead of just buying a ticket?
              </div>
              <p className="text-sm leading-relaxed text-slate-400">
                Because a fifth of the price gets you a shot at a whole ticket — and the better you
                drive, the more of the pool comes your way. Buying direct from Megapot costs you
                five times as much per ticket and rewards nothing but your wallet. The tickets here
                are the same tickets, in the same draw, on the same contract; the difference is that
                you can be good at getting them.
              </p>
            </div>
          </div>
        </section>

        {/* ── Integration transparency ───────────────────────────────── */}
        {jackpot && (
          <section className="mt-8">
            <div className="card p-6">
              <div className="chip mb-4">On-chain</div>
              <div className="grid gap-5 sm:grid-cols-3">
                <div>
                  <div className="stat-label">Jackpot contract</div>
                  <a
                    href={`https://${jackpot.network === 'mainnet' ? '' : 'sepolia.'}basescan.org/address/${jackpot.jackpotAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="num mt-1 block truncate text-sm text-[var(--accent)] hover:underline"
                  >
                    {jackpot.jackpotAddress}
                  </a>
                </div>
                <div>
                  <div className="stat-label">Referral fee earned</div>
                  <div className="num mt-1 text-sm text-slate-300">
                    {jackpot.referralFeePct.toFixed(1)}% of ticket · {jackpot.referralWinSharePct.toFixed(1)}% of wins
                  </div>
                </div>
                <div>
                  <div className="stat-label">Network</div>
                  <div className="mt-1 text-sm text-slate-300">
                    {jackpot.network === 'mainnet' ? 'Base mainnet' : 'Base Sepolia (testnet)'} · chain {jackpot.chainId}
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className={`num mt-1 text-2xl font-bold ${accent ? 'text-[var(--gold)]' : 'text-slate-100'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
      <div className="num text-xs font-bold text-[var(--accent)]">{n}</div>
      <div className="mt-2 font-bold text-slate-100">{title}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{body}</p>
    </div>
  );
}
