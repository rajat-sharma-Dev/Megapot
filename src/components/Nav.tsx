'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { shortAddress } from '@/lib/wallet/useWallet';

const LINKS = [
  { href: '/', label: 'Hub' },
  { href: '/race', label: 'Race' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/profile', label: 'Profile' },
];

export function Nav({ address, name }: { address: string | null; name?: string }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[#05070d]/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="flex items-center gap-2.5 shrink-0">
          <VaultMark />
          <span
            className="text-[15px] font-extrabold tracking-tight"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            RALLY<span className="text-[var(--accent)]">VAULT</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/[0.08] text-white'
                    : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {address ? (
            <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] pulse-dot" />
              <div className="leading-tight">
                {name && <div className="text-xs font-semibold text-slate-200">{name}</div>}
                <div className="num text-[11px] text-slate-500">{shortAddress(address)}</div>
              </div>
            </div>
          ) : (
            <div className="h-9 w-32 animate-pulse rounded-xl bg-white/[0.05]" />
          )}
        </div>
      </div>
    </header>
  );
}

function VaultMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="27" height="27" rx="8" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="16" cy="16" r="7" stroke="var(--gold)" strokeWidth="2" />
      <circle cx="16" cy="16" r="2.2" fill="var(--gold)" />
      <path d="M16 5.5v3.5M16 23v3.5M5.5 16h3.5M23 16h3.5" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
