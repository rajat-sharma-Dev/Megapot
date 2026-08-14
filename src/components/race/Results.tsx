'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { breakdownRows, ordinal } from '@/lib/points/scoring';
import { ShardMeter } from '../ShardMeter';
import { useSound } from '@/lib/audio/SoundProvider';
import { formatUsdc } from '@/lib/format';
import type { LobbyView, PlayerProfile } from '@/lib/hooks';

/**
 * The score sheet, and the moment the money moves.
 *
 * Structured around one question in one line — did you take the pot — because
 * that is the only thing a player actually wants to know, and everything below
 * it is the evidence. The standings come before the breakdown deliberately: the
 * pot is decided by a comparison, so the comparison is the headline and your own
 * lines are the explanation.
 */
export function Results({
  lobby,
  profile,
  onRaceAgain,
  canRaceAgain,
  explorerBase,
}: {
  lobby: LobbyView;
  profile: PlayerProfile | null;
  onRaceAgain: () => void;
  canRaceAgain: boolean;
  /** Network-correct block explorer root, so testnet links don't point at mainnet. */
  explorerBase: string;
}) {
  const { play, engine } = useSound();
  const settlement = lobby.settlement;
  const breakdown = lobby.myBreakdown;
  const stung = useRef(false);

  const iWon = !!settlement && settlement.winnerSeat === lobby.mySeat && lobby.mySeat !== null;
  const fromBehind = iWon && (breakdown?.placement ?? 1) > 1;
  const shardsWon = iWon ? settlement!.stakedSeats : 0;
  const ticketsMinted = iWon ? (settlement?.ticketsMinted ?? 0) : 0;

  // One stinger per result, on the first render that has a settlement.
  useEffect(() => {
    if (!settlement || stung.current) return;
    stung.current = true;
    engine.duckMusic(2.4);
    if (ticketsMinted > 0) {
      play('win');
      setTimeout(() => play('ticket'), 700);
    } else if (iWon) {
      play('win');
    } else {
      play('lose');
    }
  }, [settlement, iWon, ticketsMinted, play, engine]);

  if (!settlement) {
    return (
      <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center gap-5 text-center">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/10 border-t-[var(--accent)]" />
        <div>
          <p className="display font-semibold text-slate-200">Resolving the lobby…</p>
          <p className="mt-1 text-sm text-slate-500">
            Waiting on the other seats. Every run is replayed server-side before the pot moves.
          </p>
        </div>
      </div>
    );
  }

  const rows = breakdown ? breakdownRows(breakdown) : [];
  const runnerUp = settlement.standings[1];
  const margin = runnerUp ? settlement.standings[0].points - runnerUp.points : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-10">
      {/* ── Headline ────────────────────────────────────────────────── */}
      <div
        className={`panel rise relative overflow-hidden p-5 text-center sm:p-8 ${
          iWon ? 'win-halo' : ''
        } ${!iWon && margin > 0 && margin <= 12 ? 'shake' : ''}`}
      >
        {iWon && <div className="absolute inset-x-0 top-0 h-px shimmer" />}

        <div className="eyebrow">
          {settlement.refunded
            ? 'No result'
            : iWon
              ? 'You took the pot'
              : settlement.houseWins
                ? 'The house took the pot'
                : `${settlement.winnerName} took the pot`}
        </div>

        <div
          className={`display count-in mt-3 text-5xl leading-none sm:text-7xl ${
            iWon ? 'text-[var(--gold)] glow-gold' : 'text-slate-200'
          }`}
        >
          {settlement.refunded ? 'VOID' : iWon ? formatUsdc(settlement.potUnits) : `${breakdown?.total ?? 0} pts`}
        </div>

        {settlement.refunded ? (
          <p className="mt-4 text-sm text-slate-400">
            Nobody scored a point, so every stake was returned. Your entry is back in your balance.
          </p>
        ) : iWon ? (
          <p className="mt-4 text-sm text-slate-300">
            <span className="num font-bold text-[var(--gold)]">{shardsWon}</span>{' '}
            {shardsWon === 1 ? 'shard' : 'shards'} into your vault
            {margin > 0 && (
              <>
                {' '}
                · won by <span className="num text-slate-200">{margin}</span>{' '}
                {margin === 1 ? 'point' : 'points'}
              </>
            )}
          </p>
        ) : (
          <p className="mt-4 text-sm text-slate-400">
            {breakdown?.retired
              ? 'You left the race, which forfeits the finish bonus, your position and the clean-run bonus.'
              : `${settlement.standings[0].points} points took it. You were ${
                  (settlement.standings.findIndex((s) => s.index === lobby.mySeat) ?? 0) + 1
                }${suffix((settlement.standings.findIndex((s) => s.index === lobby.mySeat) ?? 0) + 1)} on score.`}
          </p>
        )}

        {/* The clearest possible demonstration of the rule. */}
        {fromBehind && (
          <div className="chip chip-gold pop mt-5">
            ★ Finished {ordinal(breakdown!.placement)} — and still took the pot
          </div>
        )}
      </div>

      {/* ── Ticket minted ───────────────────────────────────────────── */}
      {ticketsMinted > 0 && (
        <div
          className="panel panel-lit panel-gold rise p-5 text-center sm:p-7"
          style={{ animationDelay: '90ms' }}
        >
          <div className="display text-2xl text-[var(--gold)] glow-gold">
            🎟 {ticketsMinted} Megapot {ticketsMinted === 1 ? 'ticket' : 'tickets'} minted
          </div>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">
            Bought from Megapot&apos;s own contract with the protocol picking the numbers, and
            minted straight to your wallet. It is in the next draw whether this tab is open or not.
          </p>
          {settlement.txHashes.length > 0 && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {settlement.txHashes.map((h) =>
                // A simulated purchase carries a synthetic `0xdd1f…` hash that no
                // explorer can resolve. Linking it would tell the player their
                // ticket is real and then let BaseScan contradict us.
                isSimulatedHash(h) ? (
                  <span key={h} className="chip">
                    simulated — not broadcast
                  </span>
                ) : (
                  <a
                    key={h}
                    href={`${explorerBase}/tx/${h}`}
                    target="_blank"
                    rel="noreferrer"
                    className="chip chip-gold hover:underline"
                  >
                    {h.slice(0, 10)}…
                  </a>
                ),
              )}
            </div>
          )}

          <Link
            href="/vault"
            className="mt-4 inline-block text-xs text-[var(--gold)] hover:underline"
          >
            See your ticket numbers in the vault →
          </Link>
        </div>
      )}

      {settlement.mintError && iWon && (
        <div className="panel rise border-[var(--gold)]/30 p-5 text-sm text-[var(--gold)]">
          {settlement.mintError} Your shards are safe in the vault and the ticket buys on the next
          attempt.
        </div>
      )}

      {/* ── Standings ───────────────────────────────────────────────── */}
      <div className="panel rise p-4 sm:p-7" style={{ animationDelay: '140ms' }}>
        <div className="mb-4 flex items-center justify-between">
          <div className="chip chip-violet">Final standings</div>
          <span className="text-xs text-slate-500">ranked by score, not by finish</span>
        </div>

        <div className="stagger space-y-2">
          {settlement.standings.map((s, i) => {
            const isMe = s.index === lobby.mySeat;
            return (
              <div
                key={s.index}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                  s.isWinner
                    ? 'border-[var(--gold)]/45 bg-[var(--gold)]/[0.07]'
                    : isMe
                      ? 'you-row border-[var(--accent)]/40 bg-[var(--accent)]/[0.06]'
                      : 'border-white/[0.07] bg-white/[0.02]'
                }`}
              >
                <span className="num w-5 text-sm font-bold text-slate-500">{i + 1}</span>

                <div className="min-w-0 flex-1">
                  <div
                    className={`display truncate text-sm font-semibold ${
                      s.isWinner ? 'text-[var(--gold)]' : isMe ? 'text-[var(--accent)]' : 'text-slate-200'
                    }`}
                  >
                    {isMe ? 'You' : s.name}
                    {s.kind === 'bot' && <span className="ml-2 text-[10px] text-slate-600">HOUSE</span>}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {s.retired
                      ? `DNF at ${(s.progress * 100).toFixed(0)}%`
                      : `finished ${ordinal(s.placement)}`}
                  </div>
                </div>

                <span className="num text-lg font-bold text-slate-100">{s.points}</span>
                {s.isWinner && <span className="chip chip-gold">POT</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Your breakdown ──────────────────────────────────────────── */}
      {breakdown && (
        <div className="panel rise p-4 sm:p-7" style={{ animationDelay: '200ms' }}>
          <div className="chip mb-5">Your score sheet</div>
          <div className="divide-y divide-white/[0.06]">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2.5">
                <div>
                  <div
                    className={`text-sm font-medium ${
                      row.forfeited && row.value === 0 ? 'text-slate-500' : 'text-slate-200'
                    }`}
                  >
                    {row.label}
                  </div>
                  {row.hint && <div className="text-xs text-slate-500">{row.hint}</div>}
                </div>
                <div
                  className={`num text-lg font-bold ${
                    row.value < 0
                      ? 'text-[var(--danger)]'
                      : row.value === 0
                        ? 'text-slate-600'
                        : 'text-slate-100'
                  }`}
                >
                  {row.value > 0 ? '+' : ''}
                  {row.value}
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between pt-3">
              <div className="display font-semibold text-slate-100">Total</div>
              <div className="num text-2xl font-bold text-[var(--accent)]">{breakdown.total}</div>
            </div>
          </div>

          {lobby.rolloverCount > 0 && (
            <p className="mt-5 text-center text-sm text-[var(--gold)]">
              ★ The Jackpot Orb has rolled over {lobby.rolloverCount}{' '}
              {lobby.rolloverCount === 1 ? 'race' : 'races'} — worth more in the next one.
            </p>
          )}
        </div>
      )}

      {/* ── Vault progress ──────────────────────────────────────────── */}
      {profile && (
        <div className="panel rise p-4 sm:p-6" style={{ animationDelay: '260ms' }}>
          <div className="flex items-center justify-between">
            <div className="eyebrow">Shard vault</div>
            <span className="num text-sm font-bold text-[var(--gold)]">
              {profile.vault.shards % profile.vault.shardsPerTicket}/
              {profile.vault.shardsPerTicket}
            </span>
          </div>
          <div className="mt-3">
            <ShardMeter
              shards={profile.vault.shards}
              perTicket={profile.vault.shardsPerTicket}
              justWon={shardsWon}
              size="lg"
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Balance <span className="num text-slate-300">{formatUsdc(profile.balance.creditsUnits)}</span> ·{' '}
            <span className="num text-slate-300">{profile.balance.entriesAffordable}</span> entries left
          </p>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={onRaceAgain}
          disabled={!canRaceAgain}
          className="btn btn-primary px-8 py-3.5 text-base"
        >
          {canRaceAgain ? 'Race again' : 'Top up to race again'}
        </button>
        <Link href="/vault" className="btn btn-ghost px-6 py-3.5 text-base">
          Your vault
        </Link>
      </div>
    </div>
  );
}

/**
 * The dry-run marker from `syntheticHash` in `lib/megapot/purchase.ts`.
 *
 * Matched on the prefix rather than threaded through the settlement record,
 * because the record is persisted and old rows predate the flag — a hash that
 * starts with the marker was never broadcast, whenever it was written.
 */
function isSimulatedHash(hash: string): boolean {
  return hash.toLowerCase().startsWith('0xdd1f');
}

function suffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}
