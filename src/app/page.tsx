'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer, useRecentWinners } from '@/lib/hooks';
import { useSound } from '@/lib/audio/SoundProvider';
import { DemoRace } from '@/components/DemoRace';
import { SoundToggle } from '@/components/SoundToggle';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { ShardMeter } from '@/components/ShardMeter';
import { DrawCountdown } from '@/components/DrawCountdown';
import { formatUsdc } from '@/lib/format';
import { shortAddress } from '@/lib/wallet/useWallet';

/**
 * The attract screen.
 *
 * This is not a landing page, and that is the whole point. It is an arcade
 * cabinet's attract mode: the game is already running behind the glass, the
 * title is stamped over it, and there is exactly one thing to do.
 *
 * Two conventions independently argue for this shape, and they agree:
 *
 *  · Arcade attract mode existed to announce what kind of experience a machine
 *    offered AND make it feel alive from across the room — bold contrast,
 *    repeated loops, text readable at a glance. Show the essence, repeat the
 *    strongest cues, let curiosity pull the viewer the rest of the way.
 *  · The `.io` genre is built on removing friction: no menus to dig through, no
 *    lobby screen that takes longer than the match. You load the page and you
 *    are in.
 *
 * So: everything needed to start is above the fold, PRESS START is bound to the
 * keyboard the way a cabinet binds a physical button, and the explanatory
 * material is demoted to an attract cycle that rotates on its own rather than a
 * scroll funnel of feature cards. Scrolling is optional and leads to a spec
 * sheet, not a pitch.
 */

const CYCLE_MS = 5200;
const PANELS = ['controls', 'rule', 'prize', 'scores'] as const;

export default function Attract() {
  const router = useRouter();
  const wallet = useWallet();
  const { jackpot } = useJackpot();
  const { profile } = usePlayer(wallet.address);
  const { recent } = useRecentWinners();
  const { play } = useSound();

  const [panel, setPanel] = useState(0);
  const [paused, setPaused] = useState(false);

  const start = useCallback(() => {
    play('confirm');
    router.push('/play');
  }, [play, router]);

  // A cabinet's start button is a physical key, so bind one. Space is ignored
  // while typing so a name field never swallows the launch or vice versa.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      if (e.key === 'Enter' || (e.code === 'Space' && !typing)) {
        e.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [start]);

  // The attract cycle. Pauses on hover so anyone actually reading isn't
  // interrupted mid-sentence — the one thing real cabinets get wrong.
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setPanel((p) => (p + 1) % PANELS.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [paused]);

  const fee = jackpot?.economy.entryFeeUnits;

  return (
    <div className="grain relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* The machine, already running. */}
      <DemoRace className="opacity-[0.5]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_75%_at_30%_45%,rgba(4,6,12,0.94),rgba(4,6,12,0.7)_60%,rgba(4,6,12,0.9))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#04060c] to-transparent" />

      {/* ── Marquee ─────────────────────────────────────────────────────── */}
      <Ticker jackpot={jackpot} recent={recent} />

      {/* ── Chrome ──────────────────────────────────────────────────────── */}
      <header className="relative z-20 flex items-center justify-between gap-3 px-4 py-3 sm:px-7">
        <div className="flex items-center gap-2.5">
          <Bolt />
          <span className="display text-[13px] font-bold tracking-[0.2em] text-slate-400">
            CABINET 01
          </span>
        </div>
        <div className="flex items-center gap-2">
          <SoundToggle />
          <ConnectButton compact />
        </div>
      </header>

      {/* ── The screen ──────────────────────────────────────────────────── */}
      <main className="relative z-10 flex flex-1 items-center px-4 pb-6 sm:px-7">
        <div className="grid w-full max-w-6xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          {/* Title lockup — deliberately off-centre and hard against the left. */}
          <div>
            <div className="relative inline-block">
              <div
                className="display chroma select-none text-[3.4rem] font-bold leading-[0.82] tracking-[-0.03em] sm:text-[6rem] lg:text-[7.2rem]"
                style={{ transform: 'skewX(-6deg)' }}
              >
                RALLY
                <br />
                <span className="text-[var(--gold)]">VAULT</span>
              </div>
              {/* A scan sweep falling down the wordmark. */}
              <div
                className="sweep pointer-events-none absolute inset-x-0 top-0 h-6 opacity-70"
                style={{
                  background:
                    'linear-gradient(180deg, transparent, rgba(255,255,255,0.16), transparent)',
                }}
              />
            </div>

            <div className="mt-5 flex items-center gap-3">
              <span className="h-px w-8 bg-[var(--accent)]" />
              <p className="display text-[13px] font-semibold uppercase tracking-[0.3em] text-slate-300 sm:text-sm">
                Five racers · One real ticket
              </p>
            </div>

            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-slate-400">
              Everyone stakes a fifth of a Megapot lottery ticket. One driver takes the whole pot —
              and it is not whoever crosses the line first. It is whoever{' '}
              <span className="font-semibold text-white">scores</span> most.
            </p>

            {/* ── The one thing to do ─────────────────────────────────── */}
            <div className="mt-9">
              <button onClick={start} className="slab slab-accent px-10 py-5 text-lg sm:text-xl">
                <span className="blink">▶</span> Press Start
              </button>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-500">
                <span className="flex items-center gap-1.5">
                  or hit <span className="key">Enter</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-600">stake</span>
                  <span className="num font-bold text-[var(--cyan)]">
                    {fee ? formatUsdc(fee) : '—'}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="text-slate-600">race</span>
                  <span className="num font-bold text-slate-300">~70s</span>
                </span>
              </div>

              {/* Player readout, arcade style: who is at the controls. */}
              <div className="mt-6 flex items-center gap-3 text-[11px]">
                <span className="display tracking-[0.18em] text-slate-600">PLAYER</span>
                {wallet.isConnected && wallet.address ? (
                  <>
                    <span className="display font-bold tracking-wider text-[var(--accent)]">
                      {profile?.player.name ?? wallet.name}
                    </span>
                    <span className="num text-slate-600">{shortAddress(wallet.address)}</span>
                    {profile && (
                      <span className="num text-slate-500">
                        {formatUsdc(profile.balance.creditsUnits)}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="display font-bold tracking-wider text-[var(--gold)] blink">
                    INSERT WALLET
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── Attract cycle ───────────────────────────────────────────── */}
          <div
            className="lg:justify-self-end"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            <div className="brackets cut w-full max-w-md border border-white/[0.09] bg-black/55 p-6 backdrop-blur-md">
              <div className="mb-4 flex items-center justify-between">
                <span className="display text-[11px] font-bold tracking-[0.22em] text-slate-500">
                  {PANELS[panel] === 'controls' && 'HOW TO PLAY'}
                  {PANELS[panel] === 'rule' && 'THE RULE'}
                  {PANELS[panel] === 'prize' && 'THE PRIZE'}
                  {PANELS[panel] === 'scores' && 'HIGH SCORES'}
                </span>
                <div className="flex gap-1.5">
                  {PANELS.map((p, i) => (
                    <button
                      key={p}
                      onClick={() => setPanel(i)}
                      aria-label={`Show ${p}`}
                      className={`h-1.5 w-5 transition-colors ${
                        i === panel ? 'bg-[var(--accent)]' : 'bg-white/15 hover:bg-white/30'
                      }`}
                    />
                  ))}
                </div>
              </div>

              <div key={panel} className="attract-panel min-h-[228px]">
                {PANELS[panel] === 'controls' && <ControlsPanel />}
                {PANELS[panel] === 'rule' && <RulePanel />}
                {PANELS[panel] === 'prize' && (
                  <PrizePanel
                    fee={fee}
                    ticketPrice={jackpot?.ticketPrice}
                    shards={profile?.vault.shards ?? 0}
                  />
                )}
                {PANELS[panel] === 'scores' && <ScoresPanel recent={recent} />}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Base strip ──────────────────────────────────────────────────── */}
      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-3 text-[11px] sm:px-7">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="key">←</span>
            <span className="key">→</span> steer
          </span>
          <span className="flex items-center gap-1.5">
            <span className="key">Space</span> boost
          </span>
          <span className="hidden sm:inline">·</span>
          <span className="hidden sm:inline">
            drawing closes in{' '}
            {jackpot ? (
              <DrawCountdown drawTimeMs={jackpot.drawingTimeMs} />
            ) : (
              <span className="num">—</span>
            )}
          </span>
        </div>
        <a
          href="#spec"
          className="display tracking-[0.18em] text-slate-600 transition-colors hover:text-slate-300"
        >
          SPEC ▾
        </a>
      </footer>

      {/* ── Below the glass: the spec sheet, not a pitch ─────────────────── */}
      <SpecSheet jackpot={jackpot} recent={recent} />
    </div>
  );
}

/* ── Marquee ─────────────────────────────────────────────────────────────── */

function Ticker({
  jackpot,
  recent,
}: {
  jackpot: ReturnType<typeof useJackpot>['jackpot'];
  recent: ReturnType<typeof useRecentWinners>['recent'];
}) {
  const items = [
    jackpot && `MEGAPOT JACKPOT $${jackpot.prizePoolFormatted}`,
    jackpot && `TICKET $${jackpot.ticketPriceFormatted}`,
    jackpot && `ENTRY ${formatUsdc(jackpot.economy.entryFeeUnits)}`,
    'HIGHEST SCORE TAKES THE POT',
    recent?.totals.ticketsMinted
      ? `${recent.totals.ticketsMinted} TICKETS MINTED`
      : 'FIVE SHARDS = ONE REAL TICKET',
    jackpot && `${Number(jackpot.ticketsBought).toLocaleString()} TICKETS IN THIS ROUND`,
    'NOT FIRST PAST THE LINE — HIGHEST SCORING',
    jackpot?.network === 'mainnet' ? 'LIVE ON BASE' : 'LIVE ON BASE SEPOLIA',
  ].filter(Boolean) as string[];

  if (!items.length) return null;

  return (
    <div className="marquee relative z-20 border-b border-white/[0.09] bg-black/60 py-2 backdrop-blur-sm">
      {/* Duplicated so the -50% translate loops seamlessly. */}
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center" aria-hidden={copy === 1}>
            {items.map((text, i) => (
              <span
                key={`${copy}-${i}`}
                className="display flex items-center gap-4 px-6 text-[11px] font-semibold tracking-[0.2em] text-slate-400"
              >
                <span className="text-[var(--gold)]">◆</span>
                {text}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Attract panels ──────────────────────────────────────────────────────── */

function ControlsPanel() {
  return (
    <div className="space-y-3">
      {[
        { keys: ['←', '→'], alt: 'A / D', label: 'Steer', body: 'Or drag anywhere on touch.' },
        {
          keys: ['Space'],
          label: 'Boost',
          body: 'Held, not tapped. Burns fuel and works through a stun — it is how you recover from a hit.',
        },
        { keys: ['Esc'], label: 'Quit', body: 'Keeps what you collected. Forfeits the rest.' },
      ].map((row) => (
        <div key={row.label} className="flex gap-3.5">
          <div className="flex shrink-0 gap-1 pt-0.5">
            {row.keys.map((k) => (
              <span key={k} className="key">
                {k}
              </span>
            ))}
          </div>
          <div>
            <div className="display text-sm font-bold text-slate-100">{row.label}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{row.body}</p>
          </div>
        </div>
      ))}
      <div className="!mt-5 flex gap-4 border-t border-white/[0.07] pt-3 text-[11px]">
        <Swatch color="var(--accent)" label="points" />
        <Swatch color="var(--cyan)" label="fuel" />
        <Swatch color="#f59e0b" label="trap" />
        <Swatch color="var(--gold)" label="orb" />
      </div>
    </div>
  );
}

function RulePanel() {
  return (
    <div>
      <p className="text-sm leading-relaxed text-slate-400">
        Finishing first is worth 60 points. A full run scores about 140. So the sprint matters —
        and it is never enough on its own.
      </p>

      <div className="mt-4 space-y-2">
        <ScoreRow place="1st" detail="won the sprint, collected nothing" total={131} />
        <ScoreRow place="3rd" detail="swept the track, clean run" total={171} winner />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Which is why a race stays live to the last corner. Nobody knows who won until the scores
        land.
      </p>
    </div>
  );
}

function PrizePanel({
  fee,
  ticketPrice,
  shards,
}: {
  fee?: string;
  ticketPrice?: string;
  shards: number;
}) {
  return (
    <div>
      <p className="text-sm leading-relaxed text-slate-400">
        Every seat stakes exactly a fifth of a ticket, so a full five-seat pot{' '}
        <span className="text-slate-200">is</span> a ticket. Win one and it mints to your wallet on
        the spot.
      </p>

      <div className="mt-5">
        <ShardMeter shards={5} perTicket={5} size="lg" />
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="num text-slate-500">{fee ? formatUsdc(fee) : '—'} × 5</span>
          <span className="display font-bold tracking-wider text-[var(--gold)]">
            = 1 TICKET 🎟
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-1.5 border-t border-white/[0.07] pt-4 text-xs text-slate-500">
        <p>
          Win a smaller pot and the shards stack until they make a whole one. Nothing is ever
          rounded away.
        </p>
        {shards > 0 && (
          <p className="text-[var(--gold)]">
            You are holding {shards % 5} of 5 toward your next ticket.
          </p>
        )}
        {ticketPrice && (
          <p className="num text-slate-600">Live ticket price {formatUsdc(ticketPrice)}</p>
        )}
      </div>
    </div>
  );
}

function ScoresPanel({ recent }: { recent: ReturnType<typeof useRecentWinners>['recent'] }) {
  const winners = recent?.winners.slice(0, 6) ?? [];

  if (!winners.length) {
    return (
      <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center">
        <div className="display text-2xl font-bold tracking-widest text-slate-700">— — — —</div>
        <p className="mt-3 text-sm text-slate-500">No pots won yet.</p>
        <p className="display mt-1 text-sm font-bold tracking-widest text-[var(--gold)]">
          BE THE FIRST
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {winners.map((w, i) => (
        <div
          key={w.lobbyId}
          className="flex items-center gap-2.5 border-b border-white/[0.05] pb-1.5 last:border-0"
        >
          <span className="num w-4 text-[11px] font-bold text-slate-600">{i + 1}</span>
          <span
            className={`display min-w-0 flex-1 truncate text-xs font-bold tracking-wider ${
              w.isHouse ? 'text-slate-500' : 'text-[var(--accent)]'
            }`}
          >
            {w.name}
            {w.isHouse && <span className="ml-1.5 text-[9px] text-slate-700">HOUSE</span>}
          </span>
          {w.wonFromBehind && (
            <span className="num text-[9px] text-[var(--violet)]" title="Won without finishing first">
              P{w.placement}
            </span>
          )}
          {w.ticketsMinted > 0 && <span className="text-[10px]">🎟</span>}
          <span className="num text-xs font-bold text-slate-200">{w.points}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Below the glass ─────────────────────────────────────────────────────── */

function SpecSheet({
  jackpot,
  recent,
}: {
  jackpot: ReturnType<typeof useJackpot>['jackpot'];
  recent: ReturnType<typeof useRecentWinners>['recent'];
}) {
  return (
    <section
      id="spec"
      className="relative z-10 border-t border-white/[0.07] bg-[#04060c]/80 px-4 py-14 sm:px-7"
    >
      <div className="mx-auto max-w-6xl">
        <div className="flex items-baseline gap-4">
          <h2 className="display text-lg font-bold tracking-[0.22em] text-slate-300">
            SPECIFICATION
          </h2>
          <span className="h-px flex-1 bg-white/10" />
        </div>

        {/* A dense readout, not a feature grid. Deliberately monospaced and
            tabular — this is the back of the cabinet, not the flyer. */}
        <div className="mt-7 grid gap-x-10 gap-y-0 sm:grid-cols-2 lg:grid-cols-3">
          <Spec k="Field" v="5 racers, matched at random" />
          <Spec k="Race length" v="~70 seconds" />
          <Spec k="Stake" v={jackpot ? `${formatUsdc(jackpot.economy.entryFeeUnits)} — one fifth of a ticket` : '—'} />
          <Spec k="Full pot" v={jackpot ? `${formatUsdc(jackpot.economy.fullPotUnits)} — exactly one ticket` : '—'} />
          <Spec k="Winner" v="Highest total score, not first place" />
          <Spec k="Payout" v="Winner takes every staked shard" />
          <Spec k="Ticket" v="Minted direct to your wallet" />
          <Spec k="Empty seats" v="House stakes them and plays to win" />
          <Spec k="Network" v={jackpot ? (jackpot.network === 'mainnet' ? 'Base' : 'Base Sepolia') : '—'} />
          <Spec k="Sections" v="5–6 per track, never repeating" />
          <Spec k="Point cells" v="7–10 per race, 10 points each" />
          <Spec k="Fuel cans" v="13–18 per race, +32 fuel" />
          <Spec k="Score traps" v="Up to 2, −12 each" />
          <Spec k="Jackpot Orb" v="~40% of races, 80+, must finish" />
          <Spec k="Steal zones" v="Every section boundary, ±15" />
        </div>

        {recent && recent.totals.races > 0 && (
          <div className="mt-10 flex flex-wrap gap-x-10 gap-y-4 border-t border-white/[0.07] pt-7">
            <Readout label="Races settled" value={String(recent.totals.races)} />
            <Readout label="Won by players" value={String(recent.totals.humanWins)} />
            <Readout label="Tickets minted" value={String(recent.totals.ticketsMinted)} accent />
            <Readout label="Staked" value={formatUsdc(recent.totals.potUnits)} />
          </div>
        )}

        <div className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-white/[0.07] pt-7 text-[11px] text-slate-600">
          <span>
            Built on{' '}
            <a
              href="https://docs.megapot.io"
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-slate-200"
            >
              Megapot
            </a>
            {jackpot && (
              <>
                {' · '}
                <a
                  href={`https://${jackpot.network === 'mainnet' ? '' : 'sepolia.'}basescan.org/address/${jackpot.jackpotAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="num text-slate-500 hover:text-slate-300"
                >
                  {shortAddress(jackpot.jackpotAddress)}
                </a>
              </>
            )}
          </span>
          <div className="flex items-center gap-5">
            <Link href="/vault" className="hover:text-slate-300">
              Vault
            </Link>
            <Link href="/play" className="display font-bold tracking-widest text-[var(--accent)]">
              PLAY ▸
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Bits ────────────────────────────────────────────────────────────────── */

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] py-2.5">
      <span className="shrink-0 text-[11px] uppercase tracking-[0.12em] text-slate-600">{k}</span>
      <span className="num text-right text-xs text-slate-300">{v}</span>
    </div>
  );
}

function Readout({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-600">{label}</div>
      <div
        className={`num mt-1 text-2xl font-bold ${accent ? 'text-[var(--gold)]' : 'text-slate-200'}`}
      >
        {value}
      </div>
    </div>
  );
}

function ScoreRow({
  place,
  detail,
  total,
  winner,
}: {
  place: string;
  detail: string;
  total: number;
  winner?: boolean;
}) {
  return (
    <div
      className={`cut-sm flex items-center gap-3 border px-3 py-2 ${
        winner
          ? 'border-[var(--gold)]/45 bg-[var(--gold)]/[0.08]'
          : 'border-white/[0.07] bg-white/[0.02]'
      }`}
    >
      <span className="display w-8 shrink-0 text-sm font-bold text-slate-300">{place}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-slate-500">{detail}</span>
      <span
        className={`num text-lg font-bold ${winner ? 'text-[var(--gold)]' : 'text-slate-400'}`}
      >
        {total}
      </span>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-slate-500">
      <span
        className="h-2 w-2 rotate-45"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      {label}
    </span>
  );
}

function Bolt() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="27" height="27" rx="6" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="16" cy="16" r="6.5" stroke="var(--gold)" strokeWidth="2" />
      <circle cx="16" cy="16" r="2" fill="var(--gold)" />
    </svg>
  );
}
