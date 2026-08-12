'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRaceState, step, raceComplete, finalize, retire, isOut,
  TICK_DT, FUEL_MAX, MAX_TICKS,
  type RaceSimState, type RaceEvent,
} from '@/lib/game/engine';
import {
  buildTrackForRace, buildRacerSlots, HUMAN_ID, quantiseLateral,
  emptyInputLog, type InputLog,
} from '@/lib/game/replay';
import { BotController } from '@/lib/game/bots';
import { orbValue, NEAR_MISS_CAP, BOOST_TICKS_PER_POINT, BOOST_POINTS_CAP, STEAL_VALUE } from '@/lib/points/scoring';
import type { Input, RaceOutcome, Track } from '@/lib/game/types';
import { render, createFx, fxPickup, fxHit, fxOrb, fxPopup, type Fx } from './render';

const TICK_MS = TICK_DT * 1000;
/** Never advance more than this many ticks in one frame after a stall. */
const MAX_CATCHUP_TICKS = 8;

export type RaceViewProps = {
  raceId: string;
  seed: number;
  humanName: string;
  rolloverCount: number;
  onFinish: (inputs: InputLog, outcome: RaceOutcome) => void;
};

type Toast = { id: number; text: string; tone: 'gold' | 'green' | 'red' | 'violet' | 'cyan' };

export function RaceView({ raceId, seed, humanName, rolloverCount, onFinish }: RaceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mutable simulation refs — deliberately outside React state so the 60 Hz loop
  // never triggers a re-render. React only sees the throttled HUD snapshot.
  const trackRef = useRef<Track | null>(null);
  const stateRef = useRef<RaceSimState | null>(null);
  const botsRef = useRef<Map<string, BotController>>(new Map());
  const logRef = useRef<InputLog>(emptyInputLog());
  const keysRef = useRef({ left: false, right: false, boost: false });
  const touchRef = useRef<number | null>(null);
  const touchBoostRef = useRef(false);
  /** Tick the player asked to quit on; applied at the top of that tick. */
  const quitRef = useRef<number | null>(null);
  /** Open boost run being recorded, so holds compress to one pair. */
  const boostRunRef = useRef<{ start: number; len: number } | null>(null);
  const fxRef = useRef<Fx>(createFx());
  const rafRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const eventCursor = useRef(0);
  const toastId = useRef(0);
  const lastFrameRef = useRef(0);

  const [hud, setHud] = useState({
    position: 1,
    total: 5,
    progress: 0,
    fuel: FUEL_MAX,
    boosting: false,
    runScore: 0,
    cells: 0,
    cans: 0,
    hasOrb: false,
    elapsed: 0,
    stunned: false,
    sectionName: '',
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [orbAlert, setOrbAlert] = useState(false);
  const [confirmQuit, setConfirmQuit] = useState(false);

  const pushToast = useCallback((text: string, tone: Toast['tone']) => {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2000);
  }, []);

  // ── Build the race ───────────────────────────────────────────────────────
  useEffect(() => {
    const track = buildTrackForRace(seed);
    const slots = buildRacerSlots(raceId, humanName);
    trackRef.current = track;
    stateRef.current = createRaceState(track, slots.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })));

    const bots = new Map<string, BotController>();
    for (const s of slots) {
      if (s.isBot) bots.set(s.id, new BotController(s.botSeed ?? 1, s.skill ?? 'steady'));
    }
    botsRef.current = bots;
  }, [raceId, seed, humanName]);

  // ── Countdown, then go ───────────────────────────────────────────────────
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 750);
    return () => clearTimeout(id);
  }, [countdown]);

  // ── Input ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const isLeft = (e: KeyboardEvent) => e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A';
    const isRight = (e: KeyboardEvent) => e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D';

    const down = (e: KeyboardEvent) => {
      if (isLeft(e)) { keysRef.current.left = true; e.preventDefault(); }
      if (isRight(e)) { keysRef.current.right = true; e.preventDefault(); }
      // Boost is held: down starts burning, up stops. Up/W works too, for players
      // who read a vertical track as "accelerate upward".
      if (e.code === 'Space' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        keysRef.current.boost = true;
        e.preventDefault();
      }
      if (e.key === 'Escape') setConfirmQuit((v) => !v);
    };
    const up = (e: KeyboardEvent) => {
      if (isLeft(e)) keysRef.current.left = false;
      if (isRight(e)) keysRef.current.right = false;
      if (e.code === 'Space' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
        keysRef.current.boost = false;
      }
    };
    // A lost focus must not leave boost stuck on, draining the tank off-screen.
    const blur = () => { keysRef.current = { left: false, right: false, boost: false }; };

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // ── Canvas sizing at device pixel ratio ──────────────────────────────────
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!canvas || !wrap) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  /**
   * Advance exactly one tick, recording the input that drove it.
   *
   * Shared by the real-time loop and the post-quit fast-forward so both produce
   * the identical tick sequence the server will replay.
   */
  const advanceTick = useCallback((state: RaceSimState, track: Track, live: boolean) => {
    // Quit is applied at the top of its tick — same order as the server replay.
    if (quitRef.current !== null && state.tick >= quitRef.current) {
      retire(state, HUMAN_ID);
    }

    const me = state.racers.find((r) => r.id === HUMAN_ID);
    const humanOut = !me || isOut(me);

    let lateral = 0;
    let boost = false;

    if (live && !humanOut) {
      lateral = quantiseLateral(
        touchRef.current !== null
          ? touchRef.current
          : (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0),
      );
      boost = keysRef.current.boost || touchBoostRef.current;
    }

    if (!humanOut) {
      logRef.current.lateral.push(lateral);

      // Run-length encode the boost hold.
      const run = boostRunRef.current;
      if (boost) {
        if (run && run.start + run.len === state.tick) run.len++;
        else {
          if (run) logRef.current.boostRuns.push([run.start, run.len]);
          boostRunRef.current = { start: state.tick, len: 1 };
        }
      } else if (run) {
        logRef.current.boostRuns.push([run.start, run.len]);
        boostRunRef.current = null;
      }
    }

    const inputs = new Map<string, Input>();
    inputs.set(HUMAN_ID, { lateral, boost });

    for (const [id, bot] of botsRef.current) {
      const racer = state.racers.find((r) => r.id === id)!;
      inputs.set(
        id,
        isOut(racer)
          ? { lateral: 0, boost: false }
          : bot.decide(
              racer, track, state.tick,
              state.claimedPickups.get(id) ?? new Set(),
              state.orbClaimedBy !== null,
            ),
      );
    }

    step(state, inputs);
  }, []);

  /** Close any open boost run so the submitted log is complete. */
  const flushLog = useCallback(() => {
    const run = boostRunRef.current;
    if (run) {
      logRef.current.boostRuns.push([run.start, run.len]);
      boostRunRef.current = null;
    }
    logRef.current.quitTick = quitRef.current;
  }, []);

  // ── The loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (countdown > 0) return;

    let last = performance.now();
    lastFrameRef.current = last;
    let acc = 0;

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);

      const state = stateRef.current;
      const track = trackRef.current;
      const canvas = canvasRef.current;
      if (!state || !track || !canvas) return;

      acc += now - last;
      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      last = now;

      // Fixed timestep: the simulation advances in whole ticks only, so the
      // recorded input log replays identically on the server regardless of
      // this machine's frame rate.
      let ticks = 0;
      while (acc >= TICK_MS && !raceComplete(state) && ticks < MAX_CATCHUP_TICKS) {
        acc -= TICK_MS;
        ticks++;
        advanceTick(state, track, true);
      }
      if (acc > TICK_MS * 40) acc = 0; // recover from a long tab stall

      const me = state.racers.find((r) => r.id === HUMAN_ID);
      const boosting = !!me && !isOut(me) && (keysRef.current.boost || touchBoostRef.current) && me.fuel > 0;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        render({
          ctx,
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          state,
          track,
          humanId: HUMAN_ID,
          fx: fxRef.current,
          dt,
          boosting,
        });
      }

      drainEvents(state);
      updateHud(state, track, boosting);

      if (raceComplete(state) && !finishedRef.current) {
        finishedRef.current = true;
        cancelAnimationFrame(rafRef.current);
        flushLog();
        onFinish(logRef.current, finalize(state));
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  /**
   * Bail out.
   *
   * The player stops here, but the race itself has to play out — the server will
   * replay the whole thing including the bots, so the client fast-forwards the
   * remaining ticks to reach the identical outcome instead of guessing at one.
   */
  const quitRace = useCallback(() => {
    const state = stateRef.current;
    const track = trackRef.current;
    if (!state || !track || finishedRef.current) return;

    finishedRef.current = true;
    setConfirmQuit(false);
    cancelAnimationFrame(rafRef.current);

    quitRef.current = state.tick;

    let guard = 0;
    while (!raceComplete(state) && state.tick < MAX_TICKS && guard++ < MAX_TICKS) {
      advanceTick(state, track, false);
    }

    flushLog();
    onFinish(logRef.current, finalize(state));
  }, [advanceTick, flushLog, onFinish]);

  /** Turn newly emitted simulation events into HUD and particle feedback. */
  const drainEvents = (state: RaceSimState) => {
    const track = trackRef.current;
    const me = state.racers.find((r) => r.id === HUMAN_ID);

    for (let i = eventCursor.current; i < state.events.length; i++) {
      const e: RaceEvent = state.events[i];

      if (e.type === 'pickup' && e.racerId === HUMAN_ID && me) {
        fxPickup(fxRef.current, e.kind, me.x, me.y, e.value);
        if (e.kind === 'trap') pushToast(`Score Trap — −${e.value}`, 'red');
        else if (e.kind === 'fuel') pushToast('Fuel topped up', 'cyan');
      } else if (e.type === 'orb') {
        if (e.racerId === HUMAN_ID && me) {
          fxOrb(fxRef.current, me.x, me.y);
          pushToast(`JACKPOT ORB — +${orbValue(rolloverCount)}`, 'gold');
        } else {
          pushToast('Orb taken by a rival', 'red');
        }
        setOrbAlert(false);
      } else if (e.type === 'hard_hit' && e.racerId === HUMAN_ID && me) {
        fxHit(fxRef.current, me.x, me.y);
        pushToast('Hit — boost to recover', 'red');
      } else if (e.type === 'steal' && e.racerId === HUMAN_ID && me) {
        fxPopup(fxRef.current, `+${STEAL_VALUE} STOLEN`, me.x, me.y, '#a78bfa');
        pushToast('Overtake — points stolen', 'violet');
      } else if (e.type === 'steal' && e.victimId === HUMAN_ID) {
        pushToast('You got robbed at the checkpoint', 'red');
      } else if (e.type === 'finish' && e.racerId === HUMAN_ID && me && track) {
        fxPopup(fxRef.current, 'FINISH', me.x, me.y, '#34d399', true);
      }
    }
    eventCursor.current = state.events.length;
  };

  const updateHud = (state: RaceSimState, track: Track, boosting: boolean) => {
    const me = state.racers.find((r) => r.id === HUMAN_ID);
    if (!me) return;

    const ahead = state.racers.filter((r) => r.id !== HUMAN_ID && (r.finished || r.y > me.y)).length;
    const t = state.tick * TICK_DT;

    // Alert when the orb is live and still unclaimed.
    if (track.orb && !state.orbClaimedBy && t >= track.orb.activateAt && track.orb.y > me.y) {
      setOrbAlert(true);
    }

    const section = track.sections.find((s) => me.y >= s.startY && me.y < s.startY + s.length);

    // Live subtotal of everything already banked. The finish bonus and podium are
    // deliberately excluded — they only exist if you reach the line, and showing
    // them early would make quitting look cheaper than it is.
    const runScore = Math.max(
      0,
      me.pickupPoints +
        Math.min(NEAR_MISS_CAP, me.nearMisses) +
        Math.min(BOOST_POINTS_CAP, Math.floor(me.boostTicks / BOOST_TICKS_PER_POINT)) +
        (me.hasOrb ? orbValue(rolloverCount) : 0) +
        Math.min(2, me.steals) * STEAL_VALUE -
        Math.min(2, me.stolenFrom) * STEAL_VALUE,
    );

    setHud({
      position: ahead + 1,
      total: state.racers.length,
      progress: Math.min(100, (me.y / track.length) * 100),
      fuel: me.fuel,
      boosting,
      runScore,
      cells: me.cellsCollected,
      cans: me.fuelCansCollected,
      hasOrb: me.hasOrb,
      elapsed: t,
      stunned: me.stunTicks > 0,
      sectionName: section?.name ?? '',
    });
  };

  // ── Touch steering ───────────────────────────────────────────────────────
  const onPointer = (e: React.PointerEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width; // 0..1
    touchRef.current = Math.max(-1, Math.min(1, (rel - 0.5) * 2.6));
    // Bottom fifth of the screen doubles as the boost pedal on touch.
    touchBoostRef.current = (e.clientY - rect.top) / rect.height > 0.8;
  };

  const fuelPct = Math.max(0, Math.min(100, (hud.fuel / FUEL_MAX) * 100));
  const fuelEmpty = hud.fuel <= 0.5;

  return (
    <div className="relative">
      <div
        ref={wrapRef}
        className="relative h-[74vh] min-h-[460px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerUp={() => { touchRef.current = null; touchBoostRef.current = false; }}
        onPointerLeave={() => { touchRef.current = null; touchBoostRef.current = false; }}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />

        {/* ── Top HUD ──────────────────────────────────────────────── */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div className="hud-card">
            <div className="stat-label">Position</div>
            <div className="num text-2xl font-extrabold leading-none text-white">
              {hud.position}
              <span className="text-sm text-slate-500">/{hud.total}</span>
            </div>
          </div>

          <div className="hud-card text-center">
            <div className="stat-label">{hud.sectionName || 'Track'}</div>
            <div className="num mt-0.5 text-sm font-bold text-slate-200">
              {hud.progress.toFixed(0)}%
            </div>
          </div>

          <div className="flex items-start gap-2">
            <div className="hud-card text-right">
              <div className="stat-label">Run score</div>
              <div
                className={`num text-2xl font-extrabold leading-none ${hud.hasOrb ? 'text-[var(--gold)]' : 'text-white'}`}
              >
                {hud.runScore}
              </div>
            </div>
            <button
              onClick={() => setConfirmQuit(true)}
              className="pointer-events-auto rounded-xl border border-white/10 bg-black/65 px-3 py-2.5 text-xs font-semibold text-slate-400 backdrop-blur-md transition hover:border-[var(--danger)]/50 hover:text-[var(--danger)]"
              title="Quit this race (Esc)"
            >
              Quit
            </button>
          </div>
        </div>

        {/* ── Bottom HUD: fuel is the star ─────────────────────────── */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-4">
          {orbAlert && (
            <div className="chip chip-gold orb-glow animate-pulse text-sm">
              ★ JACKPOT ORB IS LIVE — first one there takes it
            </div>
          )}

          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/70 px-4 py-3 backdrop-blur-md">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="stat-label">
                {fuelEmpty ? <span className="text-[var(--danger)]">Tank empty — find a can</span> : 'Boost fuel'}
              </span>
              <span className="num text-xs font-bold text-[var(--cyan)]">{fuelPct.toFixed(0)}%</span>
            </div>

            <div className="fuel-track">
              <div
                className={`fuel-fill ${hud.boosting ? 'fuel-burning' : ''}`}
                style={{ width: `${fuelPct}%` }}
              />
              {/* Segment ticks make the drain rate legible at a glance. */}
              <div className="fuel-ticks" />
            </div>

            <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-slate-500">
              <span><b className="text-slate-300">← →</b> steer</span>
              <span className="text-slate-700">·</span>
              <span>
                <b className="text-slate-300">hold space</b> boost
              </span>
              <span className="text-slate-700">·</span>
              <span className="num">{hud.cells} cells · {hud.cans} cans</span>
            </div>
          </div>
        </div>

        {/* ── Toasts ───────────────────────────────────────────────── */}
        <div className="pointer-events-none absolute left-1/2 top-24 flex -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.tone}`}>
              {t.text}
            </div>
          ))}
        </div>

        {hud.stunned && (
          <div className="pointer-events-none absolute inset-0 border-4 border-[var(--danger)]/40" />
        )}

        {/* ── Quit confirmation ────────────────────────────────────── */}
        {confirmQuit && !finishedRef.current && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="pop card mx-4 max-w-sm p-6 text-center">
              <div className="chip mb-3" style={{ color: 'var(--danger)', borderColor: 'rgba(244,63,94,0.35)' }}>
                Leave the race?
              </div>
              <p className="text-sm leading-relaxed text-slate-400">
                You keep the <b className="text-slate-200">{hud.runScore}</b> points you&apos;ve
                already collected. You forfeit the finish bonus, the podium and the clean-run
                bonus — those all score <b className="text-slate-200">zero</b> on a DNF.
              </p>
              <div className="mt-5 flex gap-3">
                <button onClick={() => setConfirmQuit(false)} className="btn btn-ghost flex-1 py-2.5">
                  Keep racing
                </button>
                <button onClick={quitRace} className="btn btn-danger flex-1 py-2.5">
                  Quit &amp; bank {hud.runScore}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Countdown ────────────────────────────────────────────── */}
        {countdown > 0 && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/75 backdrop-blur-sm">
            <div
              key={countdown}
              className="pop num text-8xl font-extrabold text-[var(--accent)]"
              style={{ fontFamily: 'var(--font-display)', textShadow: '0 0 60px rgba(52,211,153,0.6)' }}
            >
              {countdown}
            </div>
          </div>
        )}
      </div>

      {/* ── Progress rail ──────────────────────────────────────────── */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-[width] duration-150"
          style={{ width: `${hud.progress}%` }}
        />
      </div>
    </div>
  );
}
