'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer, useRecentWinners } from '@/lib/hooks';
import { useSound } from '@/lib/audio/SoundProvider';
import { DemoRace } from '@/components/DemoRace';
import { SoundToggle } from '@/components/SoundToggle';
import { ConnectButton } from '@/components/wallet/ConnectButton';
import { VaultChip } from '@/components/VaultChip';
import { DrawCountdown } from '@/components/DrawCountdown';
import { Ticker } from '@/components/Ticker';
import { liveGames, comingSoon } from '@/lib/games';
import { formatUsdc } from '@/lib/format';
import { shortAddress } from '@/lib/wallet/useWallet';

/**
 * Mega Arcade — the front door.
 *
 * An arcade cabinet's attract mode, for a whole arcade rather than one machine:
 * a game already running behind the glass, the name stamped over it, and one
 * thing to do. Arcade attract mode existed to say what a place was and make it
 * feel alive from across the room; the `.io` genre arrives at the same answer
 * from the other direction by removing every menu between landing and playing.
 *
 * The pitch is the arcade, not the racer. Whatever cabinet you sit at, you are
 * playing five-handed for a share of a Megapot lottery ticket at a fraction of
 * what a ticket costs — so the headline sells the floor and the CTA sends you to
 * pick a machine.
 *
 * Centred, deliberately. A left-aligned wordmark reads as a marketing page; a
 * centred one reads as a title screen, which is what this is.
 */
export default function Arcade() {
  const router = useRouter();
  const wallet = useWallet();
  const { jackpot } = useJackpot();
  const { profile } = usePlayer(wallet.address);
  const { recent } = useRecentWinners();
  const { play } = useSound();

  const enter = useCallback(() => {
    play('confirm');
    router.push('/games');
  }, [play, router]);

  // A cabinet's start button is a physical key, so bind one.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable;
      if (e.key === 'Enter' || (e.code === 'Space' && !typing)) {
        e.preventDefault();
        enter();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter]);

  const fee = jackpot?.economy.entryFeeUnits;
  const live = liveGames().length;
  const soon = comingSoon().length;

  return (
    <div className="grain relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* The floor, already running. */}
      <DemoRace className="opacity-[0.42]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_70%_at_50%_45%,rgba(4,6,12,0.93),rgba(4,6,12,0.74)_55%,rgba(4,6,12,0.94))]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#04060c] to-transparent" />

      <Ticker jackpot={jackpot} recent={recent} />

      <header className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-7">
        <div className="flex items-center gap-2.5">
          <Bolt />
          <span className="display text-[13px] font-bold tracking-[0.2em] text-slate-400">
            MEGA ARCADE
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {/* Balance sits beside the wallet control, so "can I play" is answered
              without leaving the title screen. */}
          <VaultChip profile={profile} />
          <SoundToggle />
          <ConnectButton compact />
        </div>
      </header>

      {/* ── Title screen ────────────────────────────────────────────────── */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 py-8 text-center sm:px-7 sm:py-10">
        <div className="chip chip-gold mb-5 sm:mb-7">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] pulse-dot" />
          {live} game live · {soon} in development
        </div>

        <h1
          className="display chroma select-none text-[2.6rem] leading-[0.86] tracking-[-0.03em] sm:text-[5.5rem] lg:text-[8rem]"
          style={{ transform: 'skewX(-5deg)' }}
        >
          MEGA
          <br />
          <span className="text-[var(--gold)]">ARCADE</span>
        </h1>

        <div className="mt-7 flex items-center gap-3">
          <span className="h-px w-8 bg-[var(--accent)]" />
          <p className="display text-[12px] font-semibold uppercase tracking-[0.28em] text-slate-300 sm:text-sm">
            Play for a real lottery ticket
          </p>
          <span className="h-px w-8 bg-[var(--accent)]" />
        </div>

        <p className="mt-5 max-w-xl text-sm leading-relaxed text-slate-400 sm:mt-6 sm:text-[15px]">
          Multiplayer arcade games where five players stake a fifth of a{' '}
          <span className="text-slate-200">Megapot</span> lottery ticket each, and one walks away
          with the whole pot. Win enough and a real ticket mints straight to your wallet — for a
          fraction of what buying one costs.
        </p>

        <div className="mt-8 w-full sm:mt-10">
          <button onClick={enter} className="slab slab-accent w-full max-w-xs px-8 py-4 text-base sm:w-auto sm:px-12 sm:py-5 sm:text-xl">
            <span className="blink">▶</span> Select a game
          </button>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              or hit <span className="key">Enter</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-slate-600">from</span>
              <span className="num font-bold text-[var(--cyan)]">
                {fee ? formatUsdc(fee) : '—'}
              </span>
              <span className="text-slate-600">a game</span>
            </span>
          </div>
        </div>

        {/*
          Player readout, arcade style: who is at the controls.

          Gated on `ready` for the same reason the connect control is — this
          branches on connection state, which the server cannot know and the
          client can already have restored from localStorage. Rendering it
          before mount is a guaranteed hydration mismatch.
        */}
        <div className="mt-9 flex h-4 items-center justify-center gap-3 text-[11px]">
          {wallet.ready && (
            <>
              <span className="display tracking-[0.18em] text-slate-600">PLAYER</span>
              {wallet.isConnected && wallet.address ? (
                <>
                  <span className="display font-bold tracking-wider text-[var(--accent)]">
                    {profile?.player.name ?? wallet.name}
                  </span>
                  <span className="num text-slate-600">{shortAddress(wallet.address)}</span>
                </>
              ) : (
                <span className="display font-bold tracking-wider text-[var(--gold)] blink">
                  INSERT WALLET
                </span>
              )}
            </>
          )}
        </div>
      </main>

      {/* ── How the arcade pays ─────────────────────────────────────────── */}
      <section className="relative z-10 border-t border-white/[0.07] px-4 py-10 sm:px-7">
        <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
          <Step
            n="01"
            title="Fund your vault"
            body="One balance for the whole arcade. Deposit USDC from your wallet, withdraw it whenever you like."
          />
          <Step
            n="02"
            title="Pick a cabinet"
            body="Every game seats five players, costs a fifth of a ticket, and pays the whole pot to one of them."
          />
          <Step
            n="03"
            title="Win the ticket"
            body="Win the pot and it buys a real Megapot ticket, minted straight to your wallet."
            tone="gold"
          />
        </div>

        <div className="mx-auto mt-8 flex max-w-4xl flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[11px] text-slate-600">
          <span>
            Jackpot{' '}
            <span className="num font-bold text-[var(--gold)]">
              {jackpot ? `$${jackpot.prizePoolFormatted}` : '—'}
            </span>
          </span>
          <span>
            Draw closes in{' '}
            {jackpot ? (
              <DrawCountdown drawTimeMs={jackpot.drawingTimeMs} />
            ) : (
              <span className="num">—</span>
            )}
          </span>
          <span>
            Ticket{' '}
            <span className="num text-slate-400">
              {jackpot ? `$${jackpot.ticketPriceFormatted}` : '—'}
            </span>{' '}
            · your seat{' '}
            <span className="num text-[var(--cyan)]">{fee ? formatUsdc(fee) : '—'}</span>
          </span>
          {recent && recent.totals.ticketsMinted > 0 && (
            <span>
              <span className="num text-slate-400">{recent.totals.ticketsMinted}</span> tickets won
              here
            </span>
          )}
        </div>
      </section>

      <footer className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-4 text-[11px] text-slate-600 sm:px-7">
        <span>
          Built on{' '}
          <a
            href="https://docs.megapot.io"
            target="_blank"
            rel="noreferrer"
            className="text-slate-400 hover:text-slate-200"
          >
            Megapot
          </a>{' '}
          · {jackpot?.network === 'mainnet' ? 'Base' : 'Base Sepolia'}
        </span>
        <div className="flex items-center gap-5">
          <Link href="/vault" className="hover:text-slate-300">
            Vault
          </Link>
          <Link href="/games" className="display font-bold tracking-widest text-[var(--accent)]">
            ARCADE ▸
          </Link>
        </div>
      </footer>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  tone,
}: {
  n: string;
  title: string;
  body: string;
  tone?: 'gold';
}) {
  return (
    <div className="cut border border-white/[0.07] bg-black/40 p-5 text-left backdrop-blur-sm">
      <div
        className={`num text-xs font-bold ${tone === 'gold' ? 'text-[var(--gold)]' : 'text-[var(--accent)]'}`}
      >
        {n}
      </div>
      <div className="display mt-2 font-semibold text-slate-100">{title}</div>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

function Bolt() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="27" height="27" rx="5" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="16" cy="16" r="6.5" stroke="var(--gold)" strokeWidth="2" />
      <circle cx="16" cy="16" r="2" fill="var(--gold)" />
    </svg>
  );
}
