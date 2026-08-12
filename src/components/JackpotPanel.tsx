'use client';

import { DrawCountdown } from './DrawCountdown';
import type { Jackpot } from '@/lib/hooks';

/**
 * Live Megapot state.
 *
 * Every number here is read from the chain or Megapot's Data API — nothing is
 * static text, and that is the point of showing it at all. The prize pool is the
 * reason the ticket is worth racing for, and a hardcoded number would make the
 * whole premise a claim rather than a fact.
 */
export function JackpotPanel({ jackpot, error }: { jackpot: Jackpot | null; error: string | null }) {
  if (error) {
    return (
      <div className="panel p-6">
        <div className="chip mb-3">Megapot</div>
        <p className="text-sm text-[var(--danger)]">Couldn&apos;t reach Megapot: {error}</p>
      </div>
    );
  }

  if (!jackpot) {
    return (
      <div className="panel p-6">
        <div className="h-4 w-24 animate-pulse rounded bg-white/[0.07]" />
        <div className="mt-5 h-14 w-56 animate-pulse rounded bg-white/[0.07]" />
        <div className="mt-5 h-4 w-40 animate-pulse rounded bg-white/[0.07]" />
      </div>
    );
  }

  return (
    <div className="panel panel-lit panel-gold relative overflow-hidden p-6">
      <div className="absolute inset-x-0 top-0 h-px shimmer" />

      <div className="flex items-center justify-between gap-3">
        <div className="chip chip-gold">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] pulse-dot" />
          Live jackpot
        </div>
        <span className="chip">
          {jackpot.network === 'mainnet' ? 'Base' : 'Base Sepolia'} · round {jackpot.drawingId}
        </span>
      </div>

      <div className="mt-5">
        <div className="num text-5xl font-bold tracking-tight text-[var(--gold)] glow-gold sm:text-6xl">
          ${jackpot.prizePoolFormatted}
        </div>
        <p className="mt-2 text-sm text-slate-400">
          {Number(jackpot.ticketsBought).toLocaleString()} tickets in this round
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-5">
        <div>
          <div className="stat-label">Draw closes in</div>
          <div className="mt-1 text-lg font-bold text-slate-100">
            <DrawCountdown drawTimeMs={jackpot.drawingTimeMs} />
          </div>
        </div>
        <div>
          <div className="stat-label">Ticket price</div>
          <div className="num mt-1 text-lg font-bold text-slate-100">
            ${jackpot.ticketPriceFormatted}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="chip">normals 1–{jackpot.ballMax}</span>
        <span className="chip">bonusball 1–{jackpot.bonusballMax}</span>
        {jackpot.jackpotLock && <span className="chip chip-danger">settling</span>}
      </div>
    </div>
  );
}
