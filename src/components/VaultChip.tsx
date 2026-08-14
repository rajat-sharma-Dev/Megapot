'use client';

import Link from 'next/link';
import { formatUsdc } from '@/lib/format';
import { ShardMeter } from './ShardMeter';
import type { PlayerProfile } from '@/lib/hooks';

/**
 * Vault balance, in the header.
 *
 * The one number a player checks constantly, because it is the answer to "can I
 * play". Putting it beside the connect control means it is never more than a
 * glance away, and never a page away.
 *
 * Renders nothing without a profile, which also means nothing on the server —
 * so it can't cause a hydration mismatch the way the connect control did.
 */
export function VaultChip({
  profile,
  showShards = true,
}: {
  profile: PlayerProfile | null | undefined;
  showShards?: boolean;
}) {
  if (!profile) return null;

  return (
    <Link
      href="/vault"
      title="Your arcade vault"
      className="flex items-center gap-2.5 rounded-sm border border-white/10 bg-white/[0.04] px-2.5 py-1.5 transition-colors hover:bg-white/[0.08]"
    >
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-[0.14em] text-slate-600">Vault</div>
        <div className="num text-xs font-bold text-[var(--accent)]">
          {formatUsdc(profile.balance.creditsUnits)}
        </div>
      </div>

      {showShards && (
        <>
          <div className="h-6 w-px bg-white/10" />
          <div className="w-12">
            <ShardMeter
              shards={profile.vault.shards}
              perTicket={profile.vault.shardsPerTicket}
              size="sm"
            />
          </div>
        </>
      )}
    </Link>
  );
}
