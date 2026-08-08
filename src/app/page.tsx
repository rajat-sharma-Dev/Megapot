'use client';

import Link from 'next/link';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer } from '@/lib/hooks';
import { Nav } from '@/components/Nav';
import { JackpotPanel } from '@/components/JackpotPanel';
import { PointBankBar, CookieMeter } from '@/components/Progress';
import { TicketStrip } from '@/components/TicketStrip';
import { TICKET_THRESHOLD } from '@/lib/points/scoring';

export default function Hub() {
  const wallet = useWallet();
  const { jackpot, error } = useJackpot();
  const { profile } = usePlayer(wallet.address);

  const p = profile?.player;

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
            Race for the numbers.
            <br />
            <span className="text-[var(--accent)]">Win a real ticket.</span>
          </h1>

          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-400">
            A 5-player obstacle race on a track built fresh every time. The Shards you
            collect become the numbers on a real Megapot lottery ticket — minted straight
            to your wallet on Base.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/race" className="btn btn-primary px-7 py-3.5 text-base">
              Race now
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
            <Link href="/leaderboard" className="btn btn-ghost px-6 py-3.5 text-base">
              Leaderboard
            </Link>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            No signup. A wallet is created for you the moment you land here.
          </p>
        </section>

        {/* ── Live state + your progress ─────────────────────────────── */}
        <section className="mt-14 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <JackpotPanel jackpot={jackpot} error={error} />

          <div className="card p-6">
            <div className="chip mb-5">Your progress</div>

            <div className="space-y-6">
              <PointBankBar points={p?.pointBank ?? 0} threshold={TICKET_THRESHOLD} />
              <CookieMeter progress={(p?.cookiePieces ?? 0) % 6} />
            </div>

            <div className="mt-6 grid grid-cols-3 gap-3 border-t border-white/[0.07] pt-5">
              <Stat label="Races" value={p?.racesCompleted ?? 0} />
              <Stat label="Lifetime pts" value={p?.lifetimePoints ?? 0} />
              <Stat label="Tickets" value={p?.ticketsEarned ?? 0} accent />
            </div>
          </div>
        </section>

        {/* ── The mechanic, explained visually ───────────────────────── */}
        <section className="mt-14">
          <div className="card overflow-hidden p-7">
            <div className="chip chip-gold mb-5">The hook</div>
            <h2
              className="text-2xl font-bold tracking-tight sm:text-3xl"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Your ticket is built by playing
            </h2>
            <p className="mt-3 max-w-2xl text-slate-400">
              A Megapot ticket is five numbers plus a bonusball. In Rally Vault you don&apos;t
              pick them from a menu — you collect them on the track. Grab five Shards and
              they&apos;re your numbers. Claim the Golden Orb and its bonusball is yours too.
            </p>

            <div className="mt-8 rounded-2xl border border-white/[0.07] bg-black/25 p-6">
              <div className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
                Mid-race, this fills up live
              </div>
              <TicketStrip earned={[7, 14, 22]} bonusball={null} />
              <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
                <span className="inline-block h-2.5 w-2.5 rounded-sm bg-emerald-400" /> earned from a Shard
                <span className="ml-4 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-slate-600" /> not yet collected
                <span className="ml-4 inline-block h-2.5 w-2.5 rounded-sm bg-amber-400" /> bonusball from the Orb
              </div>
            </div>

            <div className="mt-7 grid gap-4 sm:grid-cols-3">
              <Step n="01" title="Race" body="Five racers, a randomly generated track, 60–90 seconds. Nothing to memorise." />
              <Step n="02" title="Collect" body="Shards carry numbers. The Golden Orb carries the bonusball, and rolls over when nobody grabs it." />
              <Step n="03" title="Mint" body={`Cross ${TICKET_THRESHOLD} points and the game buys you a real ticket, carrying the numbers you earned.`} />
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
