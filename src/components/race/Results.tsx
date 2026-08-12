'use client';

import Link from 'next/link';
import { DayCountdown } from '../DrawCountdown';
import { breakdownRows, ordinal } from '@/lib/points/scoring';
import type { ScoreBreakdown } from '@/lib/points/scoring';

export type SettlementPayload = {
  breakdown: ScoreBreakdown;
  placement: number;
  pointsAwarded: number;
  retired: boolean;
  dayKey: string;
  dayPoints: number;
  dayRaces: number;
  dayRank: number;
  dayBest: number;
  lifetimePoints: number;
  racesCompleted: number;
  bestRaceScore: number;
  isPersonalBest: boolean;
  credits: string;
  orbRollover: number;
};

/**
 * The score sheet.
 *
 * Shown for every run, finished or abandoned. On a DNF the forfeited lines are
 * rendered as explicit zeros rather than hidden, because the player needs to see
 * exactly what quitting cost — that is the whole reason quitting is a decision
 * rather than a trapdoor.
 */
export function Results({
  data,
  onRaceAgain,
  entriesLeft,
}: {
  data: SettlementPayload;
  onRaceAgain: () => void;
  explorerBase: string;
  entriesLeft: number | null;
}) {
  const { breakdown, placement, retired } = data;
  const podium = !retired && placement <= 3;
  const rows = breakdownRows(breakdown);
  const outOfEntries = entriesLeft !== null && entriesLeft <= 0;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* ── Headline ──────────────────────────────────────────────── */}
      <div
        className="card rise p-8 text-center"
        style={retired ? { borderColor: 'rgba(244,63,94,0.32)' } : undefined}
      >
        <div className="stat-label">{retired ? 'You left the race' : 'You finished'}</div>

        <div
          className="num mt-2 text-6xl font-extrabold leading-none sm:text-7xl"
          style={{
            fontFamily: 'var(--font-display)',
            color: retired ? 'var(--danger)' : podium ? 'var(--gold)' : 'var(--text)',
            textShadow: podium ? '0 0 50px rgba(251,191,36,0.4)' : 'none',
          }}
        >
          {retired ? 'DNF' : ordinal(placement)}
        </div>

        {retired && (
          <p className="mt-3 text-sm text-slate-400">
            Stopped {(breakdown.progress * 100).toFixed(0)}% down the track. You kept what you
            collected; the finish bonus, podium and clean-run bonus all scored zero.
          </p>
        )}

        <div className="num mt-4 text-3xl font-bold text-[var(--accent)]">
          +{data.pointsAwarded} points
        </div>

        {data.isPersonalBest && data.pointsAwarded > 0 && (
          <div className="chip chip-gold pop mt-4">★ New personal best</div>
        )}
      </div>

      {/* ── Where that puts you today ──────────────────────────────── */}
      <div className="card rise p-7" style={{ animationDelay: '80ms' }}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="chip chip-live">Today&apos;s ladder</div>
          <div className="text-xs text-slate-500">
            resets in <DayCountdown closesAt={dayClose(data.dayKey)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Rank" value={`#${data.dayRank}`} accent />
          <Stat label="Points today" value={data.dayPoints.toLocaleString()} />
          <Stat label="Races today" value={data.dayRaces} />
          <Stat label="Best run" value={data.dayBest} />
        </div>

        <p className="mt-5 text-sm leading-relaxed text-slate-400">
          Every entry fee today is pooled. When the day closes at 17:00 UTC the pool buys real
          Megapot tickets and they&apos;re minted straight to the top of this board — so the only
          thing between you and a ticket is how far you can climb before then.
        </p>
      </div>

      {/* ── Breakdown ──────────────────────────────────────────────── */}
      <div className="card rise p-7" style={{ animationDelay: '160ms' }}>
        <div className="chip mb-5">Score sheet</div>
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
            <div className="font-bold text-slate-100">Total</div>
            <div className="num text-2xl font-extrabold text-[var(--accent)]">
              +{breakdown.total}
            </div>
          </div>
        </div>

        {data.orbRollover > 0 && (
          <p className="mt-5 text-center text-sm text-[var(--gold)]">
            ★ The Jackpot Orb has rolled over {data.orbRollover}{' '}
            {data.orbRollover === 1 ? 'race' : 'races'} — worth more in the next one.
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-3 pb-8">
        <button
          onClick={onRaceAgain}
          disabled={outOfEntries}
          className="btn btn-primary px-8 py-3.5 text-base"
        >
          {outOfEntries ? 'Out of entries today' : 'Race again'}
        </button>
        <Link href="/leaderboard" className="btn btn-ghost px-6 py-3.5 text-base">
          Leaderboard
        </Link>
        <Link href="/profile" className="btn btn-ghost px-6 py-3.5 text-base">
          Your vault
        </Link>
      </div>
    </div>
  );
}

/** The 17:00 UTC close of the vault day identified by `key`. */
function dayClose(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 17)).toISOString();
}

function Stat({
  label, value, accent,
}: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div
        className={`num mt-1 text-2xl font-extrabold ${accent ? 'text-[var(--accent)]' : 'text-slate-100'}`}
      >
        {value}
      </div>
    </div>
  );
}
