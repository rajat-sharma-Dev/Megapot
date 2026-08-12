'use client';

import { useEffect, useRef } from 'react';
import { createRaceState, step, raceComplete, TICK_DT, type RaceSimState } from '@/lib/game/engine';
import { buildTrackForRace, botRoster } from '@/lib/game/replay';
import { BotController } from '@/lib/game/bots';
import { render, createFx, type Fx } from './race/render';
import type { Input, Track } from '@/lib/game/types';

/**
 * The game, playing itself.
 *
 * The hero is a real race — the same engine, the same track generator, the same
 * renderer the player will use — with all five seats driven by bots and the
 * camera following the leader. Nothing here is a video or a mock-up, which
 * matters more than it sounds: a landing page that shows the actual product in
 * motion is making a promise it can keep.
 *
 * It is deliberately cheap to run. The simulation is the same one that runs
 * during a real race, the canvas is capped at a low resolution because it sits
 * behind text at low opacity, and the whole thing suspends when the tab is
 * hidden or the element scrolls out of view.
 */
export function DemoRace({ className = '' }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    // Honour a reduced-motion preference by not animating at all — this is
    // decorative, and decorative motion is exactly what that setting is for.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let visible = true;
    let disposed = false;

    let track: Track;
    let state: RaceSimState;
    let bots: Map<string, BotController>;
    let cameraId = '';
    let fx: Fx = createFx();
    let seedCounter = Math.floor(Math.random() * 1e9);

    const startRace = () => {
      seedCounter = (seedCounter * 1664525 + 1013904223) >>> 0;
      const lobbyId = `demo-${seedCounter.toString(36)}`;
      const roster = botRoster(lobbyId);

      track = buildTrackForRace(seedCounter);
      state = createRaceState(
        track,
        roster.map((r) => ({ id: r.id, name: r.name, isBot: true })),
      );
      bots = new Map(roster.map((r) => [r.id, new BotController(r.botSeed, r.skill)]));
      cameraId = roster[0].id;
      fx = createFx();
    };

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      // Capped DPR: this is background art at ~20% opacity, and a retina-sharp
      // version of it costs four times the fill rate for no visible gain.
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    startRace();
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
      },
      { threshold: 0.01 },
    );
    io.observe(wrap);

    const onVisibility = () => {
      visible = !document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);

    let last = performance.now();
    let accumulator = 0;
    const inputs = new Map<string, Input>();

    const frame = (now: number) => {
      if (disposed) return;
      raf = requestAnimationFrame(frame);

      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;

      accumulator += dt;
      let guard = 0;
      while (accumulator >= TICK_DT && guard++ < 6) {
        accumulator -= TICK_DT;

        if (raceComplete(state)) {
          startRace();
          break;
        }

        inputs.clear();
        for (const racer of state.racers) {
          if (racer.finished || racer.retired) {
            inputs.set(racer.id, { lateral: 0, boost: false });
            continue;
          }
          inputs.set(
            racer.id,
            bots
              .get(racer.id)!
              .decide(
                racer,
                track,
                state.tick,
                state.claimedPickups.get(racer.id) ?? new Set(),
                state.orbClaimedBy !== null,
              ),
          );
        }
        step(state, inputs);
      }

      // Follow whoever is actually winning, so the hero always shows a contest.
      const leader = state.racers.reduce((a, b) => (b.y > a.y ? b : a), state.racers[0]);
      cameraId = leader.id;

      const rect = wrap.getBoundingClientRect();
      render({
        ctx,
        width: rect.width,
        height: rect.height,
        state,
        track,
        humanId: cameraId,
        fx,
        dt,
        boosting: false,
      });
    };

    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div ref={wrapRef} className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
