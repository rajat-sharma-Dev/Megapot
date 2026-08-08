'use client';

import Link from 'next/link';
import { TicketStrip } from '../TicketStrip';
import { PointBankBar, CookieMeter } from '../Progress';
import { breakdownRows, ordinal, TICKET_THRESHOLD } from '@/lib/points/scoring';
import type { ScoreBreakdown } from '@/lib/points/scoring';
import type { BuiltTicket } from '@/lib/megapot/numbers';

export type SettlementPayload = {
  breakdown: ScoreBreakdown;
  placement: number;
  pointsAwarded: number;
  pointBank: number;
  pointBankBefore: number;
  lifetimePoints: number;
  racesCompleted: number;
  cookieProgress: number;
  previewTicket: BuiltTicket | null;
  purchaseError: string | null;
  orbRollover: number;
  ticketsMinted: Array<{
    id: string;
    txHash: string;
    drawingId: string;
    normals: number[];
    bonusball: number;
    earnedNormals: number[];
    filledNormals: number[];
    bonusballEarned: boolean;
    path: 'point_bank' | 'cookie';
  }>;
  explorerBase?: string;
};

export function Results({
  data,
  onRaceAgain,
  explorerBase,
}: {
  data: SettlementPayload;
  onRaceAgain: () => void;
  explorerBase: string;
}) {
  const { breakdown, placement, previewTicket, ticketsMinted } = data;
  const podium = placement <= 3;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* ── Placement ─────────────────────────────────────────────── */}
      <div className="card rise p-8 text-center">
        <div className="stat-label">You finished</div>
        <div
          className="num mt-2 text-7xl font-extrabold leading-none"
          style={{
            fontFamily: 'var(--font-display)',
            color: podium ? 'var(--gold)' : 'var(--text)',
            textShadow: podium ? '0 0 50px rgba(251,191,36,0.4)' : 'none',
          }}
        >
          {ordinal(placement)}
        </div>
        <div className="num mt-4 text-3xl font-bold text-[var(--accent)]">
          +{data.pointsAwarded} points
        </div>
      </div>

      {/* ── Ticket earned this race ────────────────────────────────── */}
      {previewTicket && (
        <div className="card rise p-7" style={{ animationDelay: '80ms' }}>
          <div className="chip chip-gold mb-4">Numbers you earned</div>
          <div className="flex justify-center py-2">
            <TicketStrip
              earned={previewTicket.earnedNormals}
              filled={previewTicket.filledNormals}
              bonusball={previewTicket.bonusball}
            />
          </div>
          <p className="mt-4 text-center text-sm text-slate-400">
            <span className="font-semibold text-[var(--accent)]">
              {previewTicket.earnedNormals.length} of 5
            </span>{' '}
            collected on the track
            {previewTicket.filledNormals.length > 0 && (
              <>
                {' · '}
                <span className="text-slate-500">
                  {previewTicket.filledNormals.length} auto-filled
                </span>
              </>
            )}
            {' · '}
            {previewTicket.bonusballEarned ? (
              <span className="font-semibold text-[var(--gold)]">bonusball claimed from the Orb</span>
            ) : (
              <span className="text-slate-500">bonusball auto-filled</span>
            )}
          </p>
        </div>
      )}

      {/* ── Minted tickets ─────────────────────────────────────────── */}
      {ticketsMinted.length > 0 && (
        <div
          className="card rise relative overflow-hidden p-7"
          style={{ animationDelay: '160ms', borderColor: 'rgba(251,191,36,0.35)' }}
        >
          <div className="absolute inset-x-0 top-0 h-px shimmer" />
          <div className="text-center">
            <div className="text-4xl">🎟️</div>
            <h3
              className="mt-3 text-2xl font-extrabold text-[var(--gold)]"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Real Megapot ticket minted
            </h3>
            <p className="mt-1.5 text-sm text-slate-400">
              Sent to your wallet as an ERC-721 on Base.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {ticketsMinted.map((t) => (
              <div key={t.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className="chip">
                    {t.path === 'point_bank' ? 'Point Bank · earned numbers' : 'Cookie · random numbers'}
                  </span>
                  <span className="num text-xs text-slate-500">round {t.drawingId}</span>
                </div>

                {t.normals.length > 0 && (
                  <div className="flex justify-center py-2">
                    <TicketStrip
                      earned={t.earnedNormals}
                      filled={t.filledNormals}
                      bonusball={t.bonusball}
                      size="sm"
                    />
                  </div>
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
        </div>
      )}

      {data.purchaseError && (
        <div
          className="card rise p-5"
          style={{ animationDelay: '160ms', borderColor: 'rgba(244,63,94,0.3)' }}
        >
          <div className="chip mb-2" style={{ color: 'var(--danger)', borderColor: 'rgba(244,63,94,0.35)' }}>
            Ticket pending
          </div>
          <p className="text-sm text-slate-400">{data.purchaseError}</p>
          <p className="mt-2 text-xs text-slate-500">
            Your points are safe — they stay banked and the ticket mints on the next attempt.
          </p>
        </div>
      )}

      {/* ── Breakdown ──────────────────────────────────────────────── */}
      <div className="card rise p-7" style={{ animationDelay: '240ms' }}>
        <div className="chip mb-5">Points breakdown</div>
        <div className="divide-y divide-white/[0.06]">
          {breakdownRows(breakdown).map((row) => (
            <div key={row.label} className="flex items-center justify-between py-2.5">
              <div>
                <div className="text-sm font-medium text-slate-200">{row.label}</div>
                {row.hint && <div className="text-xs text-slate-500">{row.hint}</div>}
              </div>
              <div
                className={`num text-lg font-bold ${row.value < 0 ? 'text-[var(--danger)]' : 'text-slate-100'}`}
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
      </div>

      {/* ── Progress ───────────────────────────────────────────────── */}
      <div className="card rise space-y-6 p-7" style={{ animationDelay: '320ms' }}>
        <PointBankBar points={data.pointBank} threshold={TICKET_THRESHOLD} />
        <CookieMeter progress={data.cookieProgress} />
        {data.orbRollover > 0 && (
          <p className="text-center text-sm text-[var(--gold)]">
            ★ Jackpot Orb has rolled over {data.orbRollover}{' '}
            {data.orbRollover === 1 ? 'race' : 'races'} — worth more next time.
          </p>
        )}
      </div>

      <div className="flex flex-wrap justify-center gap-3 pb-8">
        <button onClick={onRaceAgain} className="btn btn-primary px-8 py-3.5 text-base">
          Race again
        </button>
        <Link href="/profile" className="btn btn-ghost px-6 py-3.5 text-base">
          Your tickets
        </Link>
        <Link href="/leaderboard" className="btn btn-ghost px-6 py-3.5 text-base">
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
