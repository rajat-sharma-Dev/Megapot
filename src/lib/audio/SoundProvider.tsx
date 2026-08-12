'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { sfx, type SfxName } from './sfx';

/**
 * Sound state for the whole app.
 *
 * Two responsibilities beyond wrapping the engine:
 *
 *  · Remember the mute choice across sessions. Somebody who turned the sound off
 *    did not mean "for this page load".
 *  · Unlock the AudioContext on the first real gesture anywhere in the document.
 *    Browsers won't start audio without one, and requiring the player to press a
 *    dedicated "enable sound" button to hear the UI they're already clicking is
 *    a worse experience than just listening for the click they were going to
 *    make anyway.
 */

const STORAGE_KEY = 'rally_sound_muted_v1';

type SoundApi = {
  muted: boolean;
  toggleMuted: () => void;
  play: (name: SfxName, opts?: { pitch?: number }) => void;
  engine: typeof sfx;
  /** True once a gesture has unlocked audio — used to nudge first-time players. */
  unlocked: boolean;
};

const SoundContext = createContext<SoundApi | null>(null);

export function SoundProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  // Restore the stored preference before anything can make a noise.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const next = stored === 'true';
      setMuted(next);
      sfx.setMuted(next);
    } catch {
      // Storage disabled — default to audible.
    }
  }, []);

  // First gesture of any kind unlocks the context, then stops listening.
  useEffect(() => {
    if (unlocked) return;

    const unlock = () => {
      if (sfx.ensure()) setUnlocked(true);
    };

    const opts = { passive: true } as const;
    window.addEventListener('pointerdown', unlock, opts);
    window.addEventListener('keydown', unlock, opts);
    window.addEventListener('touchstart', unlock, opts);

    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, [unlocked]);

  useEffect(() => () => sfx.stopMusic(), []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      sfx.ensure();
      sfx.setMuted(next);
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Ignore — the toggle still works for this session.
      }
      if (!next) sfx.play('confirm');
      return next;
    });
  }, []);

  const play = useCallback((name: SfxName, opts?: { pitch?: number }) => {
    sfx.play(name, opts);
  }, []);

  const value = useMemo<SoundApi>(
    () => ({ muted, toggleMuted, play, engine: sfx, unlocked }),
    [muted, toggleMuted, play, unlocked],
  );

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

/**
 * Sound access.
 *
 * Falls back to a silent no-op implementation outside a provider so a component
 * can always call `play()` without guarding — a missing provider should cost you
 * sound, not a crash.
 */
export function useSound(): SoundApi {
  const ctx = useContext(SoundContext);
  if (ctx) return ctx;
  return {
    muted: true,
    toggleMuted: () => {},
    play: () => {},
    engine: sfx,
    unlocked: false,
  };
}
