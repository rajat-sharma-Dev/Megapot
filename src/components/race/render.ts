/**
 * Canvas renderer.
 *
 * Draws the simulation; never mutates it. Deliberately Canvas 2D rather than a
 * WebGL engine — the art direction is flat neon geometry, so a renderer we fully
 * control is smaller, has no dependency risk, and is easier to tune than a
 * general-purpose scene graph.
 *
 * All the juice — particles, shake, flashes, floating score popups — lives in an
 * `Fx` bag owned by the view, not in the simulation. That separation is load
 * bearing: the server replays races with no renderer at all, so anything that
 * affects the outcome must never live here.
 */

import { TRACK_WIDTH, PLAYER_RADIUS, type Track, type PickupKind } from '@/lib/game/types';
import { obstacleX, obstacleActive } from '@/lib/game/trackgen';
import type { RaceSimState } from '@/lib/game/engine';
import { TICK_DT, BASE_SPEED, FUEL_MAX } from '@/lib/game/engine';

/** Track units visible above and below the player. */
const VIEW_AHEAD = 780;
const VIEW_BEHIND = 300;

const COLORS = {
  bg: '#05070d',
  lane: 'rgba(148,163,184,0.055)',
  edge: 'rgba(148,163,184,0.22)',
  hard: '#f43f5e',
  soft: '#60a5fa',
  gate: '#a78bfa',
  cell: '#34d399',
  fuel: '#22d3ee',
  trap: '#f59e0b',
  orb: '#fbbf24',
  player: '#34d399',
  boost: '#fb923c',
  checkpoint: 'rgba(167,139,250,0.5)',
};

const RIVAL_HUES = ['#f472b6', '#60a5fa', '#c084fc', '#fb923c'];

// ─── Effects state ──────────────────────────────────────────────────────────

type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; color: string;
  glow: boolean;
};

type Popup = {
  x: number; y: number; vy: number;
  life: number; maxLife: number; text: string; color: string; big: boolean;
};

export type Fx = {
  particles: Particle[];
  popups: Popup[];
  /** Screen shake magnitude in px, decays to 0. */
  shake: number;
  /** Full-screen flash alpha, decays to 0. */
  flash: number;
  flashColor: string;
  /** Ramps while boosting; drives the speed streaks and the flame. */
  boostGlow: number;
};

export const createFx = (): Fx => ({
  particles: [],
  popups: [],
  shake: 0,
  flash: 0,
  flashColor: '#ffffff',
  boostGlow: 0,
});

const PICKUP_FX: Record<PickupKind, { color: string; count: number }> = {
  cell: { color: COLORS.cell, count: 14 },
  fuel: { color: COLORS.fuel, count: 16 },
  trap: { color: COLORS.trap, count: 18 },
};

/** Spray particles from a point in TRACK coordinates. */
export function fxBurst(
  fx: Fx,
  x: number,
  y: number,
  color: string,
  count = 14,
  speed = 260,
) {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const v = speed * (0.4 + Math.random() * 0.8);
    fx.particles.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      life: 0.45 + Math.random() * 0.4,
      maxLife: 0.85,
      size: 2 + Math.random() * 3.5,
      color,
      glow: true,
    });
  }
  // Cheap guard against unbounded growth if something spams bursts.
  if (fx.particles.length > 900) fx.particles.splice(0, fx.particles.length - 900);
}

export function fxPickup(fx: Fx, kind: PickupKind, x: number, y: number, value: number) {
  const spec = PICKUP_FX[kind];
  fxBurst(fx, x, y, spec.color, spec.count);
  fxPopup(
    fx,
    kind === 'fuel' ? `+${value} FUEL` : kind === 'trap' ? `−${value}` : `+${value}`,
    x, y,
    spec.color,
  );
}

export function fxPopup(fx: Fx, text: string, x: number, y: number, color: string, big = false) {
  fx.popups.push({ x, y, vy: 150, life: 1.0, maxLife: 1.0, text, color, big });
  if (fx.popups.length > 40) fx.popups.shift();
}

export function fxHit(fx: Fx, x: number, y: number) {
  fx.shake = Math.min(16, fx.shake + 11);
  fx.flash = Math.max(fx.flash, 0.4);
  fx.flashColor = COLORS.hard;
  fxBurst(fx, x, y, COLORS.hard, 22, 340);
}

export function fxOrb(fx: Fx, x: number, y: number) {
  fx.shake = Math.min(16, fx.shake + 6);
  fx.flash = Math.max(fx.flash, 0.5);
  fx.flashColor = COLORS.orb;
  fxBurst(fx, x, y, COLORS.orb, 46, 460);
  fxPopup(fx, 'JACKPOT ORB', x, y, COLORS.orb, true);
}

/** Advance every effect. Called once per frame with real elapsed time. */
function stepFx(fx: Fx, dt: number, boosting: boolean) {
  fx.shake = Math.max(0, fx.shake - dt * 42);
  fx.flash = Math.max(0, fx.flash - dt * 2.6);
  fx.boostGlow = Math.max(0, Math.min(1, fx.boostGlow + (boosting ? dt * 5 : -dt * 4)));

  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.life -= dt;
    if (p.life <= 0) { fx.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.93;
    p.vy *= 0.93;
  }

  for (let i = fx.popups.length - 1; i >= 0; i--) {
    const p = fx.popups[i];
    p.life -= dt * 1.15;
    if (p.life <= 0) { fx.popups.splice(i, 1); continue; }
    p.y += p.vy * dt;
    p.vy *= 0.94;
  }
}

// ─── Frame ──────────────────────────────────────────────────────────────────

export type RenderOpts = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  state: RaceSimState;
  track: Track;
  humanId: string;
  fx: Fx;
  /** Real seconds since the previous frame, for effect animation. */
  dt: number;
  boosting: boolean;
};

export function render({
  ctx, width, height, state, track, humanId, fx, dt, boosting,
}: RenderOpts) {
  /**
   * Nothing to draw into a zero-sized canvas.
   *
   * A hidden or not-yet-laid-out element reports width 0, which makes every
   * scaled dimension collapse and pushes some geometry negative. Bailing early
   * is both correct and cheaper than drawing a frame nobody can see.
   */
  if (!(width > 0) || !(height > 0)) return;

  const human = state.racers.find((r) => r.id === humanId);
  // Pickups are per-racer, so hide exactly the ones this player has taken.
  const mine = state.claimedPickups.get(humanId) ?? new Set<number>();
  const t = state.tick * TICK_DT;

  stepFx(fx, dt, boosting);

  const speedRatio = human ? human.speed / BASE_SPEED : 1;

  // Camera leads slightly at speed, so going fast literally shows you more road.
  const lead = Math.max(0, (speedRatio - 1)) * 190;
  const camY = human ? human.y : 0;

  const scale = width / TRACK_WIDTH;
  const viewTop = camY + VIEW_AHEAD + lead;
  const viewBottom = camY - VIEW_BEHIND + lead * 0.25;
  const span = viewTop - viewBottom;

  /** Track coords -> screen. y grows up-track, so screen y inverts. */
  const sx = (x: number) => x * scale;
  const sy = (y: number) => height - ((y - viewBottom) / span) * height;
  const sh = (len: number) => (len / span) * height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  if (fx.shake > 0.2) {
    ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  }

  drawLanes(ctx, width, height, viewBottom, span, sy, t, speedRatio);
  drawSpeedStreaks(ctx, width, height, speedRatio, fx.boostGlow, t);
  drawFinish(ctx, width, track, sy, t);
  drawCheckpoints(ctx, width, track, viewBottom, viewTop, sy);
  drawObstacles(ctx, track, t, viewBottom, viewTop, sx, sy, sh, scale);
  drawPickups(ctx, mine, track, viewBottom, viewTop, sx, sy, scale, t);
  drawOrb(ctx, state, track, t, viewBottom, viewTop, sx, sy, scale);
  drawParticles(ctx, fx, sx, sy, scale);
  drawRacers(ctx, state, humanId, viewBottom, viewTop, sx, sy, scale, t, fx);
  drawPopups(ctx, fx, sx, sy);

  ctx.restore();

  drawEdges(ctx, width, height);

  if (fx.flash > 0.01) {
    ctx.globalAlpha = Math.min(0.5, fx.flash);
    ctx.fillStyle = fx.flashColor;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  // Boost vignette — the screen itself leans into the acceleration.
  if (fx.boostGlow > 0.02) {
    const g = ctx.createLinearGradient(0, height, 0, height * 0.35);
    g.addColorStop(0, `rgba(251,146,60,${0.3 * fx.boostGlow})`);
    g.addColorStop(1, 'rgba(251,146,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);
  }
}

function drawLanes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewBottom: number,
  span: number,
  sy: (y: number) => number,
  t: number,
  speedRatio: number,
) {
  // Scrolling rungs give a sense of speed without any per-frame state.
  const spacing = 130;
  const first = Math.floor(viewBottom / spacing) * spacing;
  ctx.strokeStyle = COLORS.lane;
  ctx.lineWidth = 1;
  for (let y = first; y < viewBottom + span + spacing; y += spacing) {
    const py = sy(y);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(148,163,184,0.07)';
  for (const frac of [0.25, 0.5, 0.75]) {
    ctx.beginPath();
    ctx.moveTo(width * frac, 0);
    ctx.lineTo(width * frac, height);
    ctx.stroke();
  }

  // Centre chevrons pointing up-track, brightening with speed.
  ctx.strokeStyle = `rgba(52,211,153,${0.05 + 0.09 * Math.min(1, speedRatio - 0.5)})`;
  ctx.lineWidth = 2;
  const chevSpacing = 260;
  const offset = (t * 90) % chevSpacing;
  for (let y = first - offset; y < viewBottom + span + chevSpacing; y += chevSpacing) {
    const py = sy(y);
    ctx.beginPath();
    ctx.moveTo(width * 0.44, py + 14);
    ctx.lineTo(width * 0.5, py);
    ctx.lineTo(width * 0.56, py + 14);
    ctx.stroke();
  }
}

/** Side streaks that stretch with speed — the cheapest possible motion blur. */
function drawSpeedStreaks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  speedRatio: number,
  boostGlow: number,
  t: number,
) {
  const intensity = Math.max(0, speedRatio - 0.9) + boostGlow * 0.9;
  if (intensity <= 0.02) return;

  const count = Math.round(10 + intensity * 22);
  ctx.lineWidth = 1.6;

  for (let i = 0; i < count; i++) {
    // Deterministic pseudo-random placement so streaks don't strobe.
    const seed = i * 12.9898;
    const fx = (Math.sin(seed) * 0.5 + 0.5);
    const side = fx < 0.5 ? fx * 0.34 : 0.66 + (fx - 0.5) * 0.68;
    const px = side * width;

    const speed = 900 + fx * 1400;
    const py = ((t * speed + i * 173) % (height + 260)) - 130;
    const len = 60 + intensity * 190 * (0.5 + fx);

    ctx.strokeStyle = boostGlow > 0.3
      ? `rgba(251,146,60,${0.05 + 0.2 * intensity})`
      : `rgba(148,163,184,${0.04 + 0.12 * intensity})`;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, py + len);
    ctx.stroke();
  }
}

function drawFinish(
  ctx: CanvasRenderingContext2D,
  width: number,
  track: Track,
  sy: (y: number) => number,
  t: number,
) {
  const py = sy(track.length);
  if (py < -40 || py > 4000) return;

  const squares = 16;
  const w = width / squares;
  for (let i = 0; i < squares; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.6)';
    ctx.fillRect(i * w, py - 9, w, 9);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.85)';
    ctx.fillRect(i * w, py, w, 9);
  }
  ctx.shadowBlur = 26 + Math.sin(t * 4) * 10;
  ctx.shadowColor = 'rgba(255,255,255,0.5)';
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0, py - 9, width, 18);
  ctx.shadowBlur = 0;
}

function drawCheckpoints(
  ctx: CanvasRenderingContext2D,
  width: number,
  track: Track,
  viewBottom: number,
  viewTop: number,
  sy: (y: number) => number,
) {
  for (const zy of track.stealZones) {
    if (zy < viewBottom - 60 || zy > viewTop + 60) continue;
    const py = sy(zy);

    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = COLORS.checkpoint;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(width, py);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = 'rgba(167,139,250,0.85)';
    ctx.font = '600 10px ui-sans-serif, system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('STEAL ZONE', width / 2, py - 8);
  }
}

function drawObstacles(
  ctx: CanvasRenderingContext2D,
  track: Track,
  t: number,
  viewBottom: number,
  viewTop: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  sh: (l: number) => number,
  scale: number,
) {
  for (const o of track.obstacles) {
    if (o.y < viewBottom - 120 || o.y > viewTop + 120) continue;

    const active = obstacleActive(o, t);
    const ox = obstacleX(o, t);
    const py = sy(o.y);
    const boxH = Math.max(3, sh(o.halfH * 2));

    if (o.kind === 'gate' && o.gapHalf !== undefined) {
      // Two shutters with a moving gap between them.
      const gapL = sx(ox - o.gapHalf);
      const gapR = sx(ox + o.gapHalf);
      ctx.fillStyle = COLORS.gate;
      ctx.shadowBlur = 16;
      ctx.shadowColor = COLORS.gate;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(0, py - boxH / 2, Math.max(0, gapL), boxH);
      ctx.fillRect(gapR, py - boxH / 2, Math.max(0, sx(TRACK_WIDTH) - gapR), boxH);
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Mark the safe gap so the read is instant at speed.
      ctx.strokeStyle = 'rgba(52,211,153,0.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(gapL, py - boxH / 2 - 4);
      ctx.lineTo(gapR, py - boxH / 2 - 4);
      ctx.stroke();
      continue;
    }

    const w = o.halfW * 2 * scale;
    const x = sx(ox - o.halfW);

    if (!active) {
      // Telegraph the hazard while it's dormant, so timing is learnable.
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = o.barrier === 'hard' ? 'rgba(244,63,94,0.35)' : 'rgba(96,165,250,0.3)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, py - boxH / 2, w, boxH);
      ctx.restore();
      continue;
    }

    const color = o.barrier === 'hard' ? COLORS.hard : COLORS.soft;
    ctx.fillStyle = color;
    ctx.shadowBlur = o.barrier === 'hard' ? 18 : 10;
    ctx.shadowColor = color;
    ctx.globalAlpha = o.barrier === 'hard' ? 0.92 : 0.62;

    if (o.kind === 'spike') {
      // Sawtooth silhouette reads instantly as "do not touch".
      const teeth = Math.max(3, Math.round(w / 16));
      ctx.beginPath();
      ctx.moveTo(x, py + boxH / 2);
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(x + (w / teeth) * (i + 0.5), py - boxH / 2);
        ctx.lineTo(x + (w / teeth) * (i + 1), py + boxH / 2);
      }
      ctx.closePath();
      ctx.fill();
    } else if (o.kind === 'blade') {
      // Spinning bar — reads as machinery rather than a static wall.
      ctx.save();
      ctx.translate(sx(ox), py);
      ctx.rotate(t * o.speed * 1.4 + o.phase);
      roundRect(ctx, -w / 2, -boxH / 2, w, boxH, Math.min(4, boxH / 2));
      ctx.fill();
      ctx.restore();
    } else {
      roundRect(ctx, x, py - boxH / 2, w, boxH, Math.min(5, boxH / 2));
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

function drawPickups(
  ctx: CanvasRenderingContext2D,
  mine: Set<number>,
  track: Track,
  viewBottom: number,
  viewTop: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
  t: number,
) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const p of track.pickups) {
    if (mine.has(p.id)) continue;
    if (p.y < viewBottom - 60 || p.y > viewTop + 60) continue;

    const px = sx(p.x);
    const py = sy(p.y);
    const bob = Math.sin(t * 3 + p.id) * 1.6;

    if (p.kind === 'fuel') {
      // Jerrycan: unmistakably a different object from a point cell, so the
      // player never has to read a label to know what they're driving at.
      const w = 26 * scale;
      const h = 30 * scale;
      ctx.save();
      ctx.translate(px, py + bob);

      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, w * 2.2);
      halo.addColorStop(0, 'rgba(34,211,238,0.32)');
      halo.addColorStop(1, 'rgba(34,211,238,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, 0, w * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 18;
      ctx.shadowColor = COLORS.fuel;
      ctx.fillStyle = COLORS.fuel;
      roundRect(ctx, -w / 2, -h / 2, w, h, 5 * scale);
      ctx.fill();
      // Nozzle.
      ctx.fillRect(w / 2 - 2 * scale, -h / 2 - 5 * scale, 7 * scale, 6 * scale);
      ctx.shadowBlur = 0;

      // Lightning glyph.
      ctx.fillStyle = '#04232b';
      ctx.beginPath();
      ctx.moveTo(-3 * scale, -9 * scale);
      ctx.lineTo(5 * scale, -1 * scale);
      ctx.lineTo(0, -1 * scale);
      ctx.lineTo(4 * scale, 9 * scale);
      ctx.lineTo(-5 * scale, 0);
      ctx.lineTo(0.5 * scale, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      continue;
    }

    const isTrap = p.kind === 'trap';
    const color = isTrap ? COLORS.trap : COLORS.cell;
    /**
     * Clamped, because `bob` is an additive wobble rather than a scaled one.
     *
     * Every other radius here is `k * scale` and so is never negative. This one
     * adds a bob of up to -1.6, so when the canvas has no width yet — before
     * layout settles, or while a cabinet card is off-screen — `scale` is 0 and
     * the radius goes negative, which makes createRadialGradient throw.
     */
    const r = Math.max(0.5, 17 * scale + bob);

    ctx.save();
    ctx.translate(px, py);

    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.6);
    halo.addColorStop(0, isTrap ? 'rgba(245,158,11,0.26)' : 'rgba(52,211,153,0.26)');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(t * 1.1 + p.id);
    ctx.shadowBlur = 20;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const hx = Math.cos(a) * r;
      const hy = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.shadowBlur = 0;
    ctx.fillStyle = isTrap ? '#3b2503' : '#04231a';
    ctx.font = `800 ${Math.round(13 * scale)}px ui-sans-serif, system-ui`;
    ctx.fillText(isTrap ? '!' : `+${p.value}`, px, py + 0.5);
  }

  ctx.textBaseline = 'alphabetic';
}

function drawOrb(
  ctx: CanvasRenderingContext2D,
  state: RaceSimState,
  track: Track,
  t: number,
  viewBottom: number,
  viewTop: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  const orb = track.orb;
  if (!orb || state.orbClaimedBy) return;
  if (t < orb.activateAt) return;
  if (orb.y < viewBottom - 90 || orb.y > viewTop + 90) return;

  const px = sx(orb.x);
  const py = sy(orb.y);
  const pulse = 1 + Math.sin(t * 5) * 0.12;
  const r = 24 * scale * pulse;

  const grad = ctx.createRadialGradient(px, py, 0, px, py, r * 3.4);
  grad.addColorStop(0, 'rgba(251,191,36,0.55)');
  grad.addColorStop(1, 'rgba(251,191,36,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(px, py, r * 3.4, 0, Math.PI * 2);
  ctx.fill();

  // Rotating rays — the single most eye-catching thing on the track, on purpose.
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(t * 0.9);
  ctx.strokeStyle = 'rgba(251,191,36,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35);
    ctx.lineTo(Math.cos(a) * r * 2.1, Math.sin(a) * r * 2.1);
    ctx.stroke();
  }
  ctx.restore();

  ctx.shadowBlur = 34;
  ctx.shadowColor = COLORS.orb;
  ctx.fillStyle = COLORS.orb;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#2b1a02';
  ctx.font = `800 ${Math.round(15 * scale)}px ui-sans-serif, system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', px, py + 0.5);
  ctx.textBaseline = 'alphabetic';
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  fx: Fx,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
) {
  for (const p of fx.particles) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    if (p.glow) {
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color;
    }
    ctx.beginPath();
    ctx.arc(sx(p.x), sy(p.y), Math.max(0.6, p.size * scale * a), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function drawPopups(
  ctx: CanvasRenderingContext2D,
  fx: Fx,
  sx: (x: number) => number,
  sy: (y: number) => number,
) {
  ctx.textAlign = 'center';
  for (const p of fx.popups) {
    const a = Math.max(0, Math.min(1, p.life / p.maxLife));
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.font = p.big
      ? '900 22px ui-sans-serif, system-ui'
      : '800 15px ui-sans-serif, system-ui';
    ctx.shadowBlur = 12;
    ctx.shadowColor = p.color;
    ctx.fillText(p.text, sx(p.x), sy(p.y));
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;
}

function drawRacers(
  ctx: CanvasRenderingContext2D,
  state: RaceSimState,
  humanId: string,
  viewBottom: number,
  viewTop: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
  t: number,
  fx: Fx,
) {
  let rivalIdx = 0;

  for (const r of state.racers) {
    const isHuman = r.id === humanId;
    const color = isHuman ? COLORS.player : RIVAL_HUES[rivalIdx++ % RIVAL_HUES.length];

    if (r.y < viewBottom - 80 || r.y > viewTop + 80) {
      if (!isHuman) drawOffscreenPip(ctx, r, viewTop, sx, sy, color);
      continue;
    }

    const px = sx(r.x);
    const py = sy(r.y);
    const rad = PLAYER_RADIUS * scale;

    // Retired racers are ghosts — visibly out of the race.
    if (r.retired) {
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      continue;
    }

    // Boost flame for the human — drawn behind, so it reads as thrust.
    if (isHuman && fx.boostGlow > 0.05) {
      const len = rad * (2.4 + fx.boostGlow * 3.2);
      const flame = ctx.createLinearGradient(px, py, px, py + len);
      flame.addColorStop(0, `rgba(251,146,60,${0.85 * fx.boostGlow})`);
      flame.addColorStop(0.5, `rgba(251,191,36,${0.5 * fx.boostGlow})`);
      flame.addColorStop(1, 'rgba(244,63,94,0)');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(px - rad * 0.72, py);
      ctx.lineTo(px + rad * 0.72, py);
      ctx.lineTo(px + Math.sin(t * 30) * 3, py + len);
      ctx.closePath();
      ctx.fill();
    }

    // Motion trail — cheap, and it sells the speed.
    ctx.globalAlpha = isHuman ? 0.28 : 0.16;
    ctx.fillStyle = color;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(px, py + i * 9, rad * (1 - i * 0.19), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const stunned = r.stunTicks > 0;
    if (stunned && Math.floor(t * 14) % 2 === 0) ctx.globalAlpha = 0.4;

    ctx.shadowBlur = isHuman ? 24 : 12;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(px, py, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = 'rgba(5,7,13,0.9)';
    ctx.beginPath();
    ctx.arc(px, py, rad * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Fuel ring on the player — read your tank without leaving the track.
    if (isHuman) {
      const frac = Math.max(0, Math.min(1, r.fuel / FUEL_MAX));
      if (frac > 0) {
        ctx.strokeStyle = COLORS.fuel;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 8;
        ctx.shadowColor = COLORS.fuel;
        ctx.beginPath();
        ctx.arc(px, py, rad + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }

    if (r.hasOrb) {
      ctx.strokeStyle = COLORS.orb;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 14;
      ctx.shadowColor = COLORS.orb;
      ctx.beginPath();
      ctx.arc(px, py, rad + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    if (!isHuman) {
      ctx.fillStyle = 'rgba(226,232,240,0.75)';
      ctx.font = '600 11px ui-sans-serif, system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(r.name, px, py - rad - 9);
    }
  }
}

/** Rivals off-screen still show as an edge pip, so you always know where you stand. */
function drawOffscreenPip(
  ctx: CanvasRenderingContext2D,
  r: { y: number; x: number; name: string },
  viewTop: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  color: string,
) {
  const ahead = r.y > viewTop;
  const py = ahead ? 14 : sy(r.y);
  const px = sx(r.x);

  ctx.globalAlpha = 0.6;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(px, ahead ? py - 7 : py + 7);
  ctx.lineTo(px - 6, ahead ? py + 4 : py - 4);
  ctx.lineTo(px + 6, ahead ? py + 4 : py - 4);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawEdges(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = COLORS.edge;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(1, 0);
  ctx.lineTo(1, height);
  ctx.moveTo(width - 1, 0);
  ctx.lineTo(width - 1, height);
  ctx.stroke();

  // Vignette keeps attention on the centre lane.
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, 'rgba(5,7,13,0.85)');
  grad.addColorStop(0.16, 'rgba(5,7,13,0)');
  grad.addColorStop(0.88, 'rgba(5,7,13,0)');
  grad.addColorStop(1, 'rgba(5,7,13,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
