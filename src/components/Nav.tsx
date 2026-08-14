'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton } from './wallet/ConnectButton';
import { SoundToggle } from './SoundToggle';
import { VaultChip } from './VaultChip';
import { useSound } from '@/lib/audio/SoundProvider';
import type { PlayerProfile } from '@/lib/hooks';

const LINKS = [
  { href: '/games', label: 'Arcade' },
  { href: '/vault', label: 'Vault' },
];

/**
 * The top bar.
 *
 * Doubles as the player's HUD outside a race: balance and tickets won are
 * always visible, because both are one click from being spent and a player
 * should never have to navigate to find out whether they can afford a race.
 */
export function Nav({ profile }: { profile?: PlayerProfile | null }) {
  const pathname = usePathname();
  const { play } = useSound();

  return (
    <header className="sticky top-0 z-40 h-16 shrink-0 overflow-visible border-b border-white/[0.07] bg-[#04060c]/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-3 sm:gap-5 sm:px-5">
        <Link
          href="/"
          onClick={() => play('click')}
          className="flex shrink-0 items-center gap-2.5"
        >
          <VaultMark />
          <span className="display text-[15px] font-bold tracking-tight">
            MEGA<span className="text-[var(--gold)]">ARCADE</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => {
            const active = l.href === '/' ? pathname === '/' : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => play('hover')}
                className={`display rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.09] text-white'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
          <VaultChip profile={profile} />

          <SoundToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}

function VaultMark() {
  return (
    <svg width="27" height="27" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="27" height="27" rx="8" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="16" cy="16" r="7" stroke="var(--gold)" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.2" fill="var(--gold)" />
      <path
        d="M16 5.5v3.5M16 23v3.5M5.5 16h3.5M23 16h3.5"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
