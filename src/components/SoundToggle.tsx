'use client';

import { useEffect, useRef, useState } from 'react';
import { useSound } from '@/lib/audio/SoundProvider';

/**
 * Sound controls.
 *
 * Click mutes everything, which is what someone reaching for this in a hurry
 * wants. The caret opens the two switches that actually matter — effects and
 * music are separate because people tire of them at very different rates, and
 * offering only "all or nothing" reliably ends in nothing.
 */
export function SoundToggle({ className = '' }: { className?: string }) {
  const { muted, toggleMuted, sfxEnabled, toggleSfx, musicEnabled, toggleMusic } = useSound();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const silent = muted || (!sfxEnabled && !musicEnabled);

  return (
    <div className={`relative ${className}`} ref={ref}>
      <div className="flex items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
        <button
          onClick={toggleMuted}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={!muted}
          title={muted ? 'Sound off' : 'Sound on'}
          className="grid h-9 w-9 place-items-center text-slate-400 transition-colors hover:bg-white/[0.07] hover:text-slate-200"
        >
          {silent ? <MutedIcon /> : <SoundIcon />}
        </button>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Sound settings"
          aria-expanded={open}
          className="grid h-9 w-5 place-items-center border-l border-white/10 text-slate-500 transition-colors hover:bg-white/[0.07] hover:text-slate-300"
        >
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path
              d="M2.5 4.5L6 8l3.5-3.5"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && (
        <div className="panel absolute right-0 top-full z-50 mt-2 w-56 p-3 pop">
          <div className="eyebrow px-1 pb-2">Sound</div>

          <Row
            label="Effects"
            hint="Pickups, hits, boost"
            on={sfxEnabled && !muted}
            disabled={muted}
            onToggle={toggleSfx}
          />
          <Row
            label="Music"
            hint="Looping bed while racing"
            on={musicEnabled && !muted}
            disabled={muted}
            onToggle={toggleMusic}
          />

          {muted && (
            <p className="mt-2 px-1 text-[11px] text-slate-500">
              Everything is muted. Tap the speaker to bring it back.
            </p>
          )}

          <p className="mt-3 border-t border-white/[0.07] px-1 pt-2 text-[11px] leading-relaxed text-slate-600">
            Races have no background drone — only the sounds of things actually
            happening.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  hint,
  on,
  disabled,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className="flex w-full items-center gap-3 rounded-lg px-1.5 py-2 text-left transition-colors hover:bg-white/[0.05] disabled:opacity-45"
    >
      <div className="min-w-0 flex-1">
        <div className="display text-sm font-semibold text-slate-200">{label}</div>
        <div className="text-[11px] text-slate-500">{hint}</div>
      </div>
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          on ? 'bg-[var(--accent)]' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-[left] duration-200 ${
            on ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </span>
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
      <path d="M16.5 9.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
