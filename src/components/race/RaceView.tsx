'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createRaceState, step, raceComplete, finalize, TICK_DT, BOOSTS_PER_RACE, type RaceSimState, type RaceEvent } from '@/lib/game/engine';
import { buildTrackForRace, buildRacerSlots, HUMAN_ID, quantiseLateral, type InputLog } from '@/lib/game/replay';
import { BotController } from '@/lib/game/bots';
import type { Input, RaceOutcome, Track } from '@/lib/game/types';
import { render } from './render';
import { TicketStrip } from '../TicketStrip';

const TICK_MS = TICK_DT * 1000;
/** Never advance more than this many ticks in one frame after a stall. */
const MAX_CATCHUP_TICKS = 8;

export type RaceViewProps = {
  raceId: string;
  seed: number;
  ballMax: number;
  bonusballMax: number;
  humanName: string;
  onFinish: (inputs: InputLog, outcome: RaceOutcome) => void;
};

type Toast = { id: number; text: string; tone: 'gold' | 'green' | 'red' | 'violet' };

export function RaceView({ raceId, seed, ballMax, bonusballMax, humanName, onFinish }: RaceViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Mutable simulation refs — deliberately outside React state so the 60 Hz loop
  // never triggers a re-render. React only sees the throttled HUD snapshot.
  const trackRef = useRef<Track | null>(null);
  const stateRef = useRef<RaceSimState | null>(null);
  const botsRef = useRef<Map<string, BotController>>(new Map());
  const logRef = useRef<InputLog>({ lateral: [], boostTicks: [] });
  const keysRef = useRef({ left: false, right: false });
  const touchRef = useRef<number | null>(null);
  const boostQueuedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const finishedRef = useRef(false);
  const eventCursor = useRef(0);
  const toastId = useRef(0);

  const [hud, setHud] = useState({
    position: 1,
    total: 5,
    progress: 0,
    numbers: [] as number[],
    bonusball: null as number | null,
    boosts: BOOSTS_PER_RACE,
    elapsed: 0,
    stunned: false,
    sectionName: '',
  });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [countdown, setCountdown] = useState(3);
  const [orbAlert, setOrbAlert] = useState(false);

  const pushToast = useCallback((text: string, tone: Toast['tone']) => {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-3), { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2200);
  }, []);

  // ── Build the race ───────────────────────────────────────────────────────
  useEffect(() => {
    const track = buildTrackForRace(seed, ballMax, bonusballMax);
    const slots = buildRacerSlots(raceId, humanName);
    trackRef.current = track;
    stateRef.current = createRaceState(track, slots.map((s) => ({ id: s.id, name: s.name, isBot: s.isBot })));

    const bots = new Map<string, BotController>();
    for (const s of slots) {
      if (s.isBot) bots.set(s.id, new BotController(s.botSeed ?? 1, s.skill ?? 'steady'));
    }
    botsRef.current = bots;
  }, [raceId, seed, ballMax, bonusballMax, humanName]);

  // ── Countdown, then go ───────────────────────────────────────────────────
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => clearTimeout(id);
  }, [countdown]);

  // ── Input ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') { keysRef.current.left = true; e.preventDefault(); }
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') { keysRef.current.right = true; e.preventDefault(); }
      if (e.code === 'Space') { boostQueuedRef.current = true; e.preventDefault(); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') keysRef.current.left = false;
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') keysRef.current.right = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
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

  // ── The loop ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (countdown > 0) return;

    let last = performance.now();
    let acc = 0;

    const frame = (now: number) => {
      rafRef.current = requestAnimationFrame(frame);

      const state = stateRef.current;
      const track = trackRef.current;
      const canvas = canvasRef.current;
      if (!state || !track || !canvas) return;

      acc += now - last;
      last = now;

      // Fixed timestep: the simulation advances in whole ticks only, so the
      // recorded input log replays identically on the server regardless of
      // this machine's frame rate.
      let ticks = 0;
      while (acc >= TICK_MS && !raceComplete(state) && ticks < MAX_CATCHUP_TICKS) {
        acc -= TICK_MS;
        ticks++;

        const lateral = quantiseLateral(
          touchRef.current !== null
            ? touchRef.current
            : (keysRef.current.right ? 1 : 0) - (keysRef.current.left ? 1 : 0),
        );
        const boost = boostQueuedRef.current;
        boostQueuedRef.current = false;

        logRef.current.lateral.push(lateral);
        if (boost) logRef.current.boostTicks.push(state.tick);

        const inputs = new Map<string, Input>();
        inputs.set(HUMAN_ID, { lateral, boost });

        for (const [id, bot] of botsRef.current) {
          const racer = state.racers.find((r) => r.id === id)!;
          inputs.set(
            id,
            racer.finished
              ? { lateral: 0, boost: false }
              : bot.decide(
                  racer, track, state.tick,
                  state.claimedShards.get(id) ?? new Set(),
                  state.orbClaimedBy !== null,
                ),
          );
        }

        step(state, inputs);
      }
      if (acc > TICK_MS * 40) acc = 0; // recover from a long tab stall

      const ctx = canvas.getContext('2d');
      if (ctx) {
        render({
          ctx,
          width: canvas.width / (Math.min(window.devicePixelRatio || 1, 2)),
          height: canvas.height / (Math.min(window.devicePixelRatio || 1, 2)),
          state,
          track,
          humanId: HUMAN_ID,
        });
      }

      drainEvents(state);
      updateHud(state, track);

      if (raceComplete(state) && !finishedRef.current) {
        finishedRef.current = true;
        cancelAnimationFrame(rafRef.current);
        onFinish(logRef.current, finalize(state));
      }
    };

    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  /** Turn newly emitted simulation events into HUD feedback. */
  const drainEvents = (state: RaceSimState) => {
    for (let i = eventCursor.current; i < state.events.length; i++) {
      const e: RaceEvent = state.events[i];
      if (e.type === 'shard' && e.racerId === HUMAN_ID) {
        pushToast(e.isTrap ? `Score Trap — ${e.number} already yours` : `Shard ${e.number} secured`, e.isTrap ? 'red' : 'green');
      } else if (e.type === 'orb') {
        if (e.racerId === HUMAN_ID) pushToast(`GOLDEN ORB — bonusball ${e.bonusball}`, 'gold');
        else pushToast('Orb taken by a rival', 'red');
        setOrbAlert(false);
      } else if (e.type === 'steal' && e.racerId === HUMAN_ID) {
        pushToast('Overtake — points stolen', 'violet');
      } else if (e.type === 'steal' && e.victimId === HUMAN_ID) {
        pushToast('You got robbed at the checkpoint', 'red');
      }
    }
    eventCursor.current = state.events.length;
  };

  const updateHud = (state: RaceSimState, track: Track) => {
    const me = state.racers.find((r) => r.id === HUMAN_ID);
    if (!me) return;

    const ahead = state.racers.filter((r) => r.id !== HUMAN_ID && (r.finished || r.y > me.y)).length;
    const t = state.tick * TICK_DT;

    // Alert when the orb is live and still unclaimed.
    if (track.orb && !state.orbClaimedBy && t >= track.orb.activateAt && track.orb.y > me.y) {
      setOrbAlert(true);
    }

    const section = track.sections.find((s) => me.y >= s.startY && me.y < s.startY + s.length);

    setHud({
      position: ahead + 1,
      total: state.racers.length,
      progress: Math.min(100, (me.y / track.length) * 100),
      numbers: me.collectedNumbers,
      bonusball: me.bonusball,
      boosts: me.boostsLeft,
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
  };

  return (
    <div className="relative">
      <div
        ref={wrapRef}
        className="relative h-[74vh] min-h-[460px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerUp={() => (touchRef.current = null)}
        onPointerLeave={() => (touchRef.current = null)}
      >
        <canvas ref={canvasRef} className="block h-full w-full touch-none" />

        {/* ── Top HUD ──────────────────────────────────────────────── */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
          <div className="rounded-xl border border-white/10 bg-black/65 px-4 py-2.5 backdrop-blur-md">
            <div className="stat-label">Position</div>
            <div className="num text-2xl font-extrabold leading-none text-white">
              {hud.position}
              <span className="text-sm text-slate-500">/{hud.total}</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/65 px-4 py-2.5 text-center backdrop-blur-md">
            <div className="stat-label">{hud.sectionName || 'Track'}</div>
            <div className="num mt-0.5 text-sm font-bold text-slate-200">
              {hud.progress.toFixed(0)}%
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/65 px-4 py-2.5 text-right backdrop-blur-md">
            <div className="stat-label">Time</div>
            <div className="num text-2xl font-extrabold leading-none text-white">
              {hud.elapsed.toFixed(1)}s
            </div>
          </div>
        </div>

        {/* ── Ticket strip — the integration, visible while playing ── */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 p-4">
          {orbAlert && (
            <div className="chip chip-gold orb-glow animate-pulse text-sm">
              ★ GOLDEN ORB IS LIVE — claim the bonusball
            </div>
          )}

          <div className="rounded-2xl border border-white/10 bg-black/70 px-5 py-3 backdrop-blur-md">
            <div className="mb-2 text-center text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              Your Megapot ticket
            </div>
            <TicketStrip earned={hud.numbers} bonusball={hud.bonusball} size="sm" />
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>← → steer</span>
            <span className="text-slate-700">·</span>
            <span>
              space boost{' '}
              <span className="num font-bold text-[var(--accent)]">×{hud.boosts}</span>
            </span>
          </div>
        </div>

        {/* ── Toasts ───────────────────────────────────────────────── */}
        <div className="pointer-events-none absolute left-1/2 top-24 flex -translate-x-1/2 flex-col items-center gap-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flash rounded-full border px-4 py-1.5 text-sm font-bold backdrop-blur-md"
              style={{
                background: 'rgba(0,0,0,0.7)',
                borderColor:
                  t.tone === 'gold' ? 'rgba(251,191,36,0.5)'
                  : t.tone === 'green' ? 'rgba(52,211,153,0.5)'
                  : t.tone === 'violet' ? 'rgba(167,139,250,0.5)'
                  : 'rgba(244,63,94,0.5)',
                color:
                  t.tone === 'gold' ? '#fbbf24'
                  : t.tone === 'green' ? '#34d399'
                  : t.tone === 'violet' ? '#a78bfa'
                  : '#f43f5e',
              }}
            >
              {t.text}
            </div>
          ))}
        </div>

        {hud.stunned && (
          <div className="pointer-events-none absolute inset-0 border-4 border-[var(--danger)]/40" />
        )}

        {/* ── Countdown ────────────────────────────────────────────── */}
        {countdown > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm">
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
