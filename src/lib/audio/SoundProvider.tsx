'use client';

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from 'react';
import { sfx, type SfxName } from './sfx';

/**
 * Sound state for the whole app.
 *
 * Three responsibilities beyond wrapping the engine:
 *
 *  · Remember the choices across sessions. Somebody who turned the music off did
 *    not mean "for this page load".
 *  · Unlock the AudioContext on the first real gesture anywhere in the document.
 *    Browsers won't start audio without one, and requiring the player to press a
 *    dedicated "enable sound" button to hear the UI they're already clicking is
 *    a worse experience than just listening for the click they were going to
 *    make anyway.
 *  · Keep effects and music independently switchable. They wear out at very
 *    different rates — a looping bed is the thing people tire of on the tenth
 *    race, while the effects are the game telling you what just happened.
 *    Forcing a choice between all of it and none of it ends with none of it.
 */

const KEY_MUTED = 'rally_sound_muted_v1';
const KEY_SFX = 'rally_sound_sfx_v1';
const KEY_MUSIC = 'rally_sound_music_v1';

type SoundApi = {
  muted: boolean;
  toggleMuted: () => void;
  sfxEnabled: boolean;
  toggleSfx: () => void;
  musicEnabled: boolean;
  toggleMusic: () => void;
  play: (name: SfxName, opts?: { pitch?: number }) => void;
  engine: typeof sfx;
  /** True once a gesture has unlocked audio — used to nudge first-time players. */
  unlocked: boolean;
};

const SoundContext = createContext<SoundApi | null>(null);

/** Read a stored boolean, defaulting when absent or storage is unavailable. */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Storage disabled — the toggle still works for this session.
  }
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState(false);
  const [sfxEnabled, setSfxEnabled] = useState(true);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [unlocked, setUnlocked] = useState(false);

  // Restore stored preferences before anything can make a noise.
  useEffect(() => {
    const m = readFlag(KEY_MUTED, false);
    const s = readFlag(KEY_SFX, true);
    // Music defaults OFF. It is the one sound a player cannot dismiss by simply
    // not doing the thing that triggers it, and a loop that starts uninvited is
    // the fastest way to get the whole app muted.
    const mu = readFlag(KEY_MUSIC, false);

    setMuted(m);
    setSfxEnabled(s);
    setMusicEnabled(mu);

    sfx.setMuted(m);
    sfx.setSfxEnabled(s);
    sfx.setMusicEnabled(mu);
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
      writeFlag(KEY_MUTED, next);
      if (!next) sfx.play('confirm');
      return next;
    });
  }, []);

  const toggleSfx = useCallback(() => {
    setSfxEnabled((prev) => {
      const next = !prev;
      sfx.ensure();
      sfx.setSfxEnabled(next);
      writeFlag(KEY_SFX, next);
      if (next) sfx.play('confirm');
      return next;
    });
  }, []);

  const toggleMusic = useCallback(() => {
    setMusicEnabled((prev) => {
      const next = !prev;
      sfx.ensure();
      sfx.setMusicEnabled(next);
      writeFlag(KEY_MUSIC, next);
      return next;
    });
  }, []);

  const play = useCallback((name: SfxName, opts?: { pitch?: number }) => {
    sfx.play(name, opts);
  }, []);

  const value = useMemo<SoundApi>(
    () => ({
      muted, toggleMuted,
      sfxEnabled, toggleSfx,
      musicEnabled, toggleMusic,
      play, engine: sfx, unlocked,
    }),
    [muted, toggleMuted, sfxEnabled, toggleSfx, musicEnabled, toggleMusic, play, unlocked],
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
    sfxEnabled: false,
    toggleSfx: () => {},
    musicEnabled: false,
    toggleMusic: () => {},
    play: () => {},
    engine: sfx,
    unlocked: false,
  };
}
