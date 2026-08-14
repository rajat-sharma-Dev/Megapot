'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createRaceState, step, raceComplete, finalize, retire, isOut,
  TICK_DT, FUEL_MAX, MAX_TICKS,
  type RaceSimState, type RaceEvent,
} from '@/lib/game/engine';
import {
  buildTrackForRace, localSeats, quantiseLateral, emptyInputLog,
  type InputLog, type SeatSpec,
} from '@/lib/game/replay';
import { BotController } from '@/lib/game/bots';
import {
  orbValue, NEAR_MISS_CAP, BOOST_TICKS_PER_POINT, BOOST_POINTS_CAP, STEAL_VALUE,
} from '@/lib/points/scoring';
import { useSound } from '@/lib/audio/SoundProvider';
import { formatUsdc } from '@/lib/format';
import type { Input, RaceOutcome, Track } from '@/lib/game/types';
import { render, createFx, fxPickup, fxHit, fxOrb, fxPopup, type Fx } from './render';
import type { SeatView } from '@/lib/hooks';

const TICK_MS = TICK_DT * 1000;
/** Never advance more than this many ticks in one frame after a stall. */
const MAX_CATCHUP_TICKS = 8;

export type RaceViewProps = {
  lobbyId: string;
  seed: number;
  seats: SeatView[];
  mySeatIndex: number;
  rolloverCount: number;
  potUnits: string;
  onFinish: (inputs: InputLog, outcome: RaceOutcome) => void;
};

type Toast = { id: number; text: string; tone: 'gold' | 'green' | 'red' | 'violet' | 'cyan' };

export function RaceView({
  lobbyId, seed, seats, mySeatIndex, rolloverCount, potUnits, onFinish,
}: RaceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const { engine, play, muted } = useSound();

  /**
   * The field, recast for a local run.
   *
   * Your seat is you; every other seat is bot-driven, including seats held by
   * other humans whose real inputs don't exist yet. Their names are kept so the
   * lobby you queued into is the lobby you see.
   */
  const localField = useMemo<SeatSpec[]>(() => {
    const specs: SeatSpec[] = seats.map((s) => ({
      index: s.index,
      id: s.id ?? `seat_${s.index}`,
      name: s.name,
      kind: s.kind === 'bot' ? 'bot' : 'human',
      skill: s.skill as SeatSpec['skill'],
      botSeed: s.botSeed,
    }));
    return localSeats(specs, mySeatIndex, lobbyId);
  }, [seats, mySeatIndex, lobbyId]);

  const myId = localField[mySeatIndex]?.id ?? 'player';

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
  const boostAudioRef = useRef(false);

  const [hud, setHud] = useState({
    position: 1,
    total: seats.length || 5,
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
  /** Live standings strip — the whole point of the game is who's scoring. */
  const [ladder, setLadder] = useState<
    Array<{ id: string; name: string; isYou: boolean; progress: number; score: number }>
  >([]);
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
    trackRef.current = track;
    stateRef.current = createRaceState(
      track,
      localField.map((s) => ({ id: s.id, name: s.name, isBot: s.kind === 'bot' })),
    );

    const bots = new Map<string, BotController>();
    for (const s of localField) {
      if (s.kind === 'bot') bots.set(s.id, new BotController(s.botSeed ?? 1, s.skill ?? 'steady'));
    }
    botsRef.current = bots;
  }, [seed, localField]);

  // ── Countdown, then go ───────────────────────────────────────────────────
  useEffect(() => {
    if (countdown <= 0) return;
    // Pitch rises through 3-2-1 so the ear knows where it is in the count.
    play('countdown', { pitch: 1 + (3 - countdown) * 0.16 });
    const id = setTimeout(() => setCountdown((c) => c - 1), 750);
    return () => clearTimeout(id);
  }, [countdown, play]);

  useEffect(() => {
    if (countdown !== 0) return;
    play('go');
    engine.startEngine();
    return () => engine.stopEngine();
  }, [countdown, play, engine]);

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
  const advanceTick = useCallback(
    (state: RaceSimState, track: Track, live: boolean) => {
      // Quit is applied at the top of its tick — same order as the server replay.
      if (quitRef.current !== null && state.tick >= quitRef.current) retire(state, myId);

      const me = state.racers.find((r) => r.id === myId);
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
      inputs.set(myId, { lateral, boost });

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
    },
    [myId],
  );

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

      const me = state.racers.find((r) => r.id === myId);
      const boosting =
        !!me && !isOut(me) && (keysRef.current.boost || touchBoostRef.current) && me.fuel > 0;

      // The only sustained sound in a race: a held loop rather than a one-shot,
      // because boost is a tank you spend and the roar has to last as long as
      // the fuel does. Nothing else drones — see the note in `sfx.ts`.
      if (boosting !== boostAudioRef.current) {
        boostAudioRef.current = boosting;
        engine.setBoost(boosting);
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        render({
          ctx,
          width: canvas.width / dpr,
          height: canvas.height / dpr,
          state,
          track,
          humanId: myId,
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
        engine.setBoost(false);
        engine.stopEngine();
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
    engine.setBoost(false);
    engine.stopEngine();
    play('back');

    quitRef.current = state.tick;

    let guard = 0;
    while (!raceComplete(state) && state.tick < MAX_TICKS && guard++ < MAX_TICKS) {
      advanceTick(state, track, false);
    }

    flushLog();
    onFinish(logRef.current, finalize(state));
  }, [advanceTick, flushLog, onFinish, engine, play]);

  /** Turn newly emitted simulation events into HUD, particle and audio feedback. */
  const drainEvents = (state: RaceSimState) => {
    const me = state.racers.find((r) => r.id === myId);

    for (let i = eventCursor.current; i < state.events.length; i++) {
      const e: RaceEvent = state.events[i];

      if (e.type === 'pickup' && e.racerId === myId && me) {
        fxPickup(fxRef.current, e.kind, me.x, me.y, e.value);
        if (e.kind === 'trap') {
          play('trap');
          pushToast(`Score Trap — −${e.value}`, 'red');
        } else if (e.kind === 'fuel') {
          play('fuel');
          pushToast('Fuel topped up', 'cyan');
        } else {
          // Rising pitch on a streak of cells — the sound of a combo.
          play('cell', { pitch: 1 + Math.min(6, me.cellsCollected) * 0.045 });
        }
      } else if (e.type === 'orb') {
        if (e.racerId === myId && me) {
          fxOrb(fxRef.current, me.x, me.y);
          play('orb');
          pushToast(`JACKPOT ORB — +${orbValue(rolloverCount)}`, 'gold');
        } else {
          play('stolen');
          pushToast('Orb taken by a rival', 'red');
        }
        setOrbAlert(false);
      } else if (e.type === 'hard_hit' && e.racerId === myId && me) {
        fxHit(fxRef.current, me.x, me.y);
        play('hit');
        pushToast('Hit — boost to recover', 'red');
      } else if (e.type === 'near_miss' && e.racerId === myId) {
        play('nearMiss');
      } else if (e.type === 'steal' && e.racerId === myId && me) {
        fxPopup(fxRef.current, `+${STEAL_VALUE} STOLEN`, me.x, me.y, '#a98bff');
        play('steal');
        pushToast('Overtake — points stolen', 'violet');
      } else if (e.type === 'steal' && e.victimId === myId) {
        play('stolen');
        pushToast('You got robbed at the checkpoint', 'red');
      } else if (e.type === 'finish' && e.racerId === myId && me) {
        fxPopup(fxRef.current, 'FINISH', me.x, me.y, '#2ee6a0', true);
        play('finish');
      }
    }
    eventCursor.current = state.events.length;
  };

  /**
   * The live subtotal shown in the HUD, for any racer.
   *
   * Only what is already banked. The finish bonus, finish position and the
   * Jackpot Orb all depend on reaching the line, so none of them are counted
   * here — showing them early would make quitting look far cheaper than it is,
   * which is exactly the decision this number exists to inform.
   */
  const liveScore = (r: RaceSimState['racers'][number]) =>
    Math.max(
      0,
      r.pickupPoints +
        Math.min(NEAR_MISS_CAP, r.nearMisses) +
        Math.min(BOOST_POINTS_CAP, Math.floor(r.boostTicks / BOOST_TICKS_PER_POINT)) +
        Math.min(2, r.steals) * STEAL_VALUE -
        Math.min(2, r.stolenFrom) * STEAL_VALUE,
    );

  const updateHud = (state: RaceSimState, track: Track, boosting: boolean) => {
    const me = state.racers.find((r) => r.id === myId);
    if (!me) return;

    const ahead = state.racers.filter((r) => r.id !== myId && (r.finished || r.y > me.y)).length;
    const t = state.tick * TICK_DT;

    // Alert when the orb is live and still unclaimed.
    if (track.orb && !state.orbClaimedBy && t >= track.orb.activateAt && track.orb.y > me.y) {
      setOrbAlert(true);
    }

    const section = track.sections.find((s) => me.y >= s.startY && me.y < s.startY + s.length);

    // Live subtotal of everything already banked. The finish bonus and finish
    // position are deliberately excluded — they only exist if you reach the
    // line, and showing them early would make quitting look cheaper than it is.
    setHud({
      position: ahead + 1,
      total: state.racers.length,
      progress: Math.min(100, (me.y / track.length) * 100),
      fuel: me.fuel,
      boosting,
      runScore: liveScore(me),
      cells: me.cellsCollected,
      cans: me.fuelCansCollected,
      hasOrb: me.hasOrb,
      elapsed: t,
      stunned: me.stunTicks > 0,
      sectionName: section?.name ?? '',
    });

    setLadder(
      [...state.racers]
        .map((r) => ({
          id: r.id,
          name: r.name,
          isYou: r.id === myId,
          progress: Math.min(1, r.y / track.length),
          score: liveScore(r),
        }))
        .sort((a, b) => b.score - a.score),
    );
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
  const fuelLow = fuelPct < 25 && !fuelEmpty;

  return (
    <div className="relative">
      <div
        ref={wrapRef}
        className="no-touch-scroll relative h-[68vh] min-h-[380px] w-full overflow-hidden rounded-sm border border-white/10 bg-black sm:h-[74vh] sm:min-h-[460px]"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerUp={() => { touchRef.current = null; touchBoostRef.current = false; }}
        onPointerLeave={() => { touchRef.current = null; touchBoostRef.current = false; }}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />

        {/* ── Top HUD ──────────────────────────────────────────────── */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-4">
          <div className="hud-card">
            <div className="stat-label">Track pos</div>
            <div className="num text-xl font-bold leading-none text-white sm:text-2xl">
              {hud.position}
              <span className="text-sm text-slate-500">/{hud.total}</span>
            </div>
          </div>

          <div className="hud-card hidden text-center sm:block">
            <div className="stat-label">{hud.sectionName || 'Track'}</div>
            <div className="num mt-0.5 text-sm font-bold text-slate-200">
              {hud.progress.toFixed(0)}%
            </div>
          </div>

          <div className="flex items-start gap-2">
            <div className="hud-card text-right">
              <div className="stat-label">Banked</div>
              <div className="num text-xl font-bold leading-none text-white sm:text-2xl">{hud.runScore}</div>
              {/* The Orb is carried, not banked — the HUD has to say which. */}
              {hud.hasOrb && (
                <div className="num mt-0.5 text-[11px] font-bold text-[var(--gold)]">
                  +{orbValue(rolloverCount)} orb at the line
                </div>
              )}
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

        {/*
          The score ladder.
          Sorted by SCORE, not by track position, because that is what decides the
          pot — a player who can only see who is physically ahead is being shown
          the wrong race.
        */}
        <div className="pointer-events-none absolute left-3 top-24 hidden w-44 flex-col gap-1 sm:flex">
          <div className="stat-label pl-1 pb-0.5">Pot standings</div>
          {ladder.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 backdrop-blur-md transition-colors ${
                r.isYou
                  ? 'border-[var(--accent)]/50 bg-[var(--accent)]/15'
                  : 'border-white/10 bg-black/55'
              }`}
            >
              <span className="num w-3 text-[11px] font-bold text-slate-500">{i + 1}</span>
              <span
                className={`min-w-0 flex-1 truncate text-[11px] font-semibold ${
                  r.isYou ? 'text-[var(--accent)]' : 'text-slate-300'
                }`}
              >
                {r.isYou ? 'YOU' : r.name}
              </span>
              <span className="num text-[11px] font-bold text-white">{r.score}</span>
            </div>
          ))}
        </div>

        {/* ── Bottom HUD: fuel is the star ─────────────────────────── */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-3 sm:p-4">
          {orbAlert && (
            <div className="chip chip-gold animate-pulse text-sm">
              ★ JACKPOT ORB IS LIVE — first one there takes it
            </div>
          )}

          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-black/70 px-4 py-3 backdrop-blur-md">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="stat-label">
                {fuelEmpty ? (
                  <span className="text-[var(--danger)]">Tank empty — find a can</span>
                ) : (
                  'Boost fuel'
                )}
              </span>
              <span className="num text-xs font-bold text-[var(--cyan)]">
                {fuelPct.toFixed(0)}%
              </span>
            </div>

            <div className={`fuel-track ${fuelLow ? 'fuel-low' : ''}`}>
              <div
                className={`fuel-fill ${hud.boosting ? 'fuel-burning' : ''}`}
                style={{ width: `${fuelPct}%` }}
              />
              {/* Segment ticks make the drain rate legible at a glance. */}
              <div className="fuel-ticks" />
            </div>

            <div className="mt-2 flex items-center justify-center gap-3 text-[11px] text-slate-500">
              <span>
                <b className="text-slate-300">← →</b> steer
              </span>
              <span className="text-slate-700">·</span>
              <span>
                <b className="text-slate-300">hold space</b> boost
              </span>
              <span className="text-slate-700">·</span>
              <span className="num">
                {hud.cells} cells · {hud.cans} cans
              </span>
            </div>
          </div>
        </div>

        {/* ── Toasts ───────────────────────────────────────────────── */}
        <div className="pointer-events-none absolute left-1/2 top-20 flex -translate-x-1/2 flex-col items-center gap-2">
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
            <div className="pop panel mx-4 max-w-sm p-6 text-center">
              <div className="chip chip-danger mb-3">Leave the race?</div>
              <p className="text-sm leading-relaxed text-slate-400">
                You keep the <b className="text-slate-200">{hud.runScore}</b> points you&apos;ve
                already collected. You forfeit the finish bonus, your finish position and the
                clean-run bonus — those all score <b className="text-slate-200">zero</b> on a DNF,
                which almost always means losing the pot.
              </p>
              {hud.hasOrb && (
                <p className="mt-2 text-sm font-semibold text-[var(--gold)]">
                  You are carrying the Jackpot Orb. Leaving forfeits all{' '}
                  {orbValue(rolloverCount)} of it.
                </p>
              )}
              <div className="mt-5 flex gap-3">
                <button
                  onClick={() => setConfirmQuit(false)}
                  className="btn btn-ghost flex-1 py-2.5"
                >
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
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/75 backdrop-blur-sm">
            <div className="chip chip-gold">
              {formatUsdc(potUnits)} pot · highest score takes it
            </div>
            <div
              key={countdown}
              className="pop display num text-6xl font-bold text-[var(--accent)] glow-accent sm:text-8xl"
            >
              {countdown}
            </div>
            {muted && <div className="text-xs text-slate-500">Sound is muted</div>}
          </div>
        )}
      </div>

      {/* ── Progress rail ──────────────────────────────────────────── */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full transition-[width] duration-150"
          style={{
            width: `${hud.progress}%`,
            background: 'linear-gradient(90deg, var(--accent-deep), var(--accent))',
          }}
        />
      </div>
    </div>
  );
}
