'use client';

import { useSound } from '@/lib/audio/SoundProvider';

/**
 * Mute.
 *
 * Prominent rather than tucked away in a settings page, because this game makes
 * noise the moment you touch it and somebody in an office needs the off switch
 * to be the first thing they find.
 */
export function SoundToggle({ className = '' }: { className?: string }) {
  const { muted, toggleMuted } = useSound();

  return (
    <button
      onClick={toggleMuted}
      aria-label={muted ? 'Unmute' : 'Mute'}
      aria-pressed={!muted}
      title={muted ? 'Sound off' : 'Sound on'}
      className={`grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-400 transition-colors hover:bg-white/[0.09] hover:text-slate-200 ${className}`}
    >
      {muted ? <MutedIcon /> : <SoundIcon />}
    </button>
  );
}

function SoundIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M16 8.6a4.6 4.6 0 0 1 0 6.8M18.7 6a8.2 8.2 0 0 1 0 12"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 9.5h3.2L12 5.5v13L7.2 14.5H4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 9.5l5 5m0-5l-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
