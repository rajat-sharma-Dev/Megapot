'use client';

import Link from 'next/link';
import { formatUsdc } from '@/lib/format';
import type { PlayerProfile } from '@/lib/hooks';

/**
 * Vault balance, in the header.
 *
 * The two numbers a player checks constantly: what they can spend, and what
 * they have won. Beside the connect control, so neither is ever a page away.
 *
 * Renders nothing without a profile, which also means nothing on the server —
 * so it can't cause a hydration mismatch the way the connect control did.
 */
export function VaultChip({ profile }: { profile: PlayerProfile | null | undefined }) {
  if (!profile) return null;

  return (
    <Link
      href="/vault"
      title="Your arcade vault"
      className="flex h-9 min-w-0 shrink items-center gap-2.5 rounded-sm border border-white/10 bg-white/[0.04] px-2.5 transition-colors hover:bg-white/[0.08]"
    >
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Vault</div>
        <div className="num text-xs font-bold text-[var(--accent)]">
          {formatUsdc(profile.balance.creditsUnits)}
        </div>
      </div>

      <div className="h-6 w-px bg-white/10" />
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Tickets</div>
        <div className="num text-xs font-bold text-[var(--gold)]">
          {profile.player.ticketsEarned}
        </div>
      </div>
    </Link>
  );
}
