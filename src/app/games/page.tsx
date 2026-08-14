'use client';

import { useRouter } from 'next/navigation';
import { useWallet } from '@/lib/wallet/useWallet';
import { useJackpot, usePlayer, useRecentWinners } from '@/lib/hooks';
import { useSound } from '@/lib/audio/SoundProvider';
import { Nav } from '@/components/Nav';
import { DemoRace } from '@/components/DemoRace';
import { GAMES, type ArcadeGame } from '@/lib/games';
import { formatUsdc } from '@/lib/format';

/**
 * The arcade floor — pick a cabinet.
 *
 * The one screen between landing and playing, so it earns its place by answering
 * the only two questions a player has: what can I play, and can I afford it. The
 * live cabinet therefore states its stake and its entry state directly on the
 * button — "Enter game" when the vault covers it, "Deposit to play" when it
 * doesn't — rather than sending someone to a race that will turn them away.
 *
 * Unreleased cabinets are visibly locked and have no route. They exist so the
 * floor reads as a floor.
 */
export default function GamesPage() {
  const wallet = useWallet();
  const { jackpot } = useJackpot(30_000);
  const { profile } = usePlayer(wallet.address);
  const { recent } = useRecentWinners();

  const balance = profile ? BigInt(profile.balance.creditsUnits) : 0n;
  const entryFee = jackpot ? BigInt(jackpot.economy.entryFeeUnits) : 0n;
  const canAfford = entryFee > 0n && balance >= entryFee;

  return (
    <>
      <Nav profile={profile} />

      <main className="mx-auto max-w-6xl px-3 pb-20 pt-6 sm:px-5 sm:pt-8">
        <div className="rise mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="eyebrow">Arcade floor</div>
            <h1 className="display mt-1 text-2xl leading-tight sm:text-5xl">Pick a cabinet</h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-400">
              Every seat stakes the same thing — a fifth of a Megapot ticket — and one player takes
              the whole pot.
            </p>
          </div>

        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {GAMES.map((game, i) => (
            <Cabinet
              key={game.id}
              game={game}
              index={i}
              entryFeeUnits={jackpot?.economy.entryFeeUnits ?? null}
              fullPotUnits={jackpot?.economy.fullPotUnits ?? null}
              canAfford={canAfford}
              connected={wallet.ready && wallet.isConnected}
              ticketsWon={game.status === 'live' ? (recent?.totals.ticketsMinted ?? 0) : 0}
            />
          ))}
        </div>

        <p className="mt-9 text-center text-xs text-slate-600">
          One vault funds every cabinet. Shards you win in any game count toward the same ticket.
        </p>
      </main>
    </>
  );
}

function Cabinet({
  game,
  index,
  entryFeeUnits,
  fullPotUnits,
  canAfford,
  connected,
  ticketsWon,
}: {
  game: ArcadeGame;
  index: number;
  entryFeeUnits: string | null;
  fullPotUnits: string | null;
  canAfford: boolean;
  connected: boolean;
  ticketsWon: number;
}) {
  const router = useRouter();
  const { play } = useSound();
  const live = game.status === 'live';

  const enter = () => {
    if (!live || !game.href) return;
    play('confirm');
    // Both states land on the same route; the game decides whether to open the
    // ready room or the deposit gate, so there is one source of truth for
    // affordability rather than two that can disagree.
    router.push(game.href);
  };

  return (
    <div
      className={`panel rise relative overflow-hidden ${live ? 'panel-lit' : ''}`}
      style={{ animationDelay: `${index * 70}ms`, opacity: live ? 1 : 0.72 }}
    >
      {/* Marquee art. The live cabinet shows its actual game running. */}
      <div className="relative h-32 overflow-hidden sm:h-40 border-b border-white/[0.07] bg-black">
        {live ? (
          <>
            <DemoRace className="opacity-70" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center">
            <div
              className="display text-6xl opacity-25"
              style={{ color: game.accent }}
              aria-hidden
            >
              {game.glyph}
            </div>
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(45deg, #fff 0 2px, transparent 2px 12px)',
              }}
            />
          </div>
        )}

        <div className="absolute left-4 top-4">
          <span className={`chip ${live ? 'chip-live' : ''}`}>
            {live ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
                Live
              </>
            ) : (
              'In development'
            )}
          </span>
        </div>

        {live && ticketsWon > 0 && (
          <div className="absolute right-4 top-4">
            <span className="chip chip-gold">🎟 {ticketsWon} won</span>
          </div>
        )}
      </div>

      {/*
        A locked cabinet shows only what is actually decided: that it exists and
        how many seats it has. No name, no pitch, and no prices — quoting a stake
        for a game nobody can play is stating terms that aren't real yet.
      */}
      {live ? (
        <div className="p-4 sm:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="display text-2xl font-bold">{game.name}</h2>
            <span className="num shrink-0 text-xs text-slate-600">
              {game.seats} players · {game.durationLabel}
            </span>
          </div>

          <p className="display mt-1 text-sm font-semibold" style={{ color: game.accent }}>
            {game.tagline}
          </p>

          <p className="mt-3 min-h-[60px] text-sm leading-relaxed text-slate-400">
            {game.description}
          </p>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-4">
            <div>
              <div className="stat-label">Your stake</div>
              <div className="num mt-0.5 text-lg font-bold text-[var(--cyan)]">
                {entryFeeUnits ? formatUsdc(entryFeeUnits) : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="stat-label">Full pot</div>
              <div className="num mt-0.5 text-lg font-bold text-[var(--gold)]">
                {fullPotUnits ? formatUsdc(fullPotUnits) : '—'}
              </div>
            </div>
          </div>

          <button
            onClick={enter}
            className={`slab mt-5 w-full py-4 text-base ${
              canAfford ? 'slab-accent' : 'slab-ghost'
            }`}
          >
            {!connected ? 'Connect & play' : canAfford ? 'Enter game' : 'Deposit to play'}
          </button>

          {connected && !canAfford && (
            <p className="mt-2 text-center text-xs text-[var(--gold)]">
              Your vault is empty — fund it and you&apos;re straight in.
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center p-4 text-center sm:p-6">
          <h2 className="display text-2xl font-bold tracking-[0.14em] text-slate-500">
            COMING SOON
          </h2>
          <p className="num mt-2 text-xs text-slate-600">{game.seats} players</p>
          <button
            disabled
            className="slab slab-ghost mt-5 w-full py-4 text-base"
            title="Not playable yet"
          >
            Locked
          </button>
        </div>
      )}
    </div>
  );
}
