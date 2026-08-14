'use client';

import { useEffect, useRef } from 'react';
import { Countdown } from '../DrawCountdown';
import { PotMeter } from '../PotMeter';
import { useSound } from '@/lib/audio/SoundProvider';
import { formatUsdc } from '@/lib/format';
import type { LobbyView } from '@/lib/hooks';

const SEAT_COLORS = ['var(--accent)', '#ff7ab8', '#5aa9ff', '#c98bff', '#ff9d4d'];

/**
 * The matchmaking screen.
 *
 * Fifteen seconds of watching seats fill is the game's only real anticipation
 * beat, so it is built as a set piece rather than a spinner: every seat that
 * lands makes a noise, the pot ticks up as it does, and the clock is visible so
 * the wait never feels indefinite.
 *
 * It also has to be honest about who it is putting you against. House seats say
 * "House" and carry their skill, because a player who thinks they beat four
 * humans and didn't has been lied to.
 */
export function Matchmaking({ lobby, onCancel }: { lobby: LobbyView; onCancel?: () => void }) {
  const { play } = useSound();
  const seenFilled = useRef(0);
  const locked = useRef(false);

  const filled = lobby.seats.filter((s) => s.kind !== 'empty').length;

  // One click per seat that arrives, and a heavier one when the doors close.
  useEffect(() => {
    if (filled > seenFilled.current) {
      play('seatJoin', { pitch: 1 + filled * 0.08 });
      seenFilled.current = filled;
    }
  }, [filled, play]);

  useEffect(() => {
    if (lobby.state !== 'open' && !locked.current) {
      locked.current = true;
      play('lock');
    }
  }, [lobby.state, play]);

  const humans = lobby.seats.filter((s) => s.kind === 'human').length;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rise mb-6 text-center">
        <div className="chip chip-live mx-auto mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
          {lobby.state === 'open' ? 'Finding racers' : 'Grid is set'}
        </div>
        <h1 className="display text-2xl sm:text-4xl">
          {lobby.state === 'open' ? 'Filling the grid' : 'Starting…'}
        </h1>
        <p className="mt-2 text-slate-400">
          {lobby.state === 'open' ? (
            <>
              Locking in <Countdown until={lobby.fillDeadline} className="text-[var(--gold)]" /> —
              the house takes whatever seats are still empty.
            </>
          ) : (
            <>Five seats, one track, one pot.</>
          )}
        </p>
      </div>

      <div className="panel panel-lit rise p-4 sm:p-6" style={{ animationDelay: '80ms' }}>
        <div className="mb-5">
          <PotMeter
            potUnits={lobby.potUnits}
            entryFeeUnits={lobby.entryFeeUnits}
            stakedSeats={lobby.stakedSeats}
            seatsTotal={lobby.seatsTotal}
          />
        </div>

        <div className="space-y-2.5">
          {lobby.seats.map((seat) => (
            <div
              key={seat.index}
              className={`seat ${seat.isYou ? 'seat-you' : ''} ${
                seat.kind === 'empty' ? 'seat-empty' : 'seat-filled'
              }`}
              style={{ animationDelay: `${seat.index * 60}ms` }}
            >
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background: seat.kind === 'empty' ? 'rgba(148,163,184,0.3)' : SEAT_COLORS[seat.index % 5],
                  boxShadow:
                    seat.kind === 'empty' ? 'none' : `0 0 12px ${SEAT_COLORS[seat.index % 5]}`,
                }}
              />

              <div className="min-w-0 flex-1">
                {seat.kind === 'empty' ? (
                  <span className="text-sm text-slate-500">Waiting for a racer…</span>
                ) : (
                  <>
                    <div
                      className={`display truncate text-sm font-semibold ${
                        seat.isYou ? 'text-[var(--accent)]' : 'text-slate-200'
                      }`}
                    >
                      {seat.name}
                    </div>
                    {seat.shortAddress && (
                      <div className="num text-[10px] text-slate-600">{seat.shortAddress}</div>
                    )}
                  </>
                )}
              </div>

              {seat.kind === 'bot' && <span className="chip">House · {seat.skill}</span>}
              {seat.isYou && <span className="chip chip-live">You</span>}
              {seat.kind === 'human' && !seat.isYou && <span className="chip chip-cyan">Player</span>}
              {seat.staked && (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[var(--gold)]"
                  title="Staked into the pot"
                />
              )}
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4 text-xs text-slate-500">
          <span>
            <span className="num text-slate-300">{humans}</span>{' '}
            {humans === 1 ? 'player' : 'players'} ·{' '}
            <span className="num text-slate-300">{formatUsdc(lobby.entryFeeUnits)}</span> a seat
          </span>
          {onCancel && lobby.state === 'open' && (
            <button onClick={onCancel} className="text-slate-500 hover:text-slate-300">
              Hide this screen
            </button>
          )}
        </div>
      </div>

      <p className="mt-5 text-center text-xs leading-relaxed text-slate-600">
        House seats stake from the house float and race to keep it. If a house racer outscores
        you, the pot goes back to the float — they are not there to lose politely.
      </p>
    </div>
  );
}
