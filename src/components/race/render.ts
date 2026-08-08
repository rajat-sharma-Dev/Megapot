/**
 * Canvas renderer.
 *
 * Draws the simulation; never mutates it. Deliberately Canvas 2D rather than a
 * WebGL engine — the art direction is flat neon geometry, so a renderer we fully
 * control is smaller, has no dependency risk, and is easier to tune than a
 * general-purpose scene graph.
 */

import { TRACK_WIDTH, PLAYER_RADIUS, type Track } from '@/lib/game/types';
import { obstacleX, obstacleActive } from '@/lib/game/trackgen';
import type { RaceSimState } from '@/lib/game/engine';
import { TICK_DT } from '@/lib/game/engine';

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
  shard: '#34d399',
  trap: '#f59e0b',
  orb: '#fbbf24',
  player: '#34d399',
  rival: '#94a3b8',
  checkpoint: 'rgba(167,139,250,0.5)',
};

const RIVAL_HUES = ['#f472b6', '#60a5fa', '#c084fc', '#fb923c'];

export type RenderOpts = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  state: RaceSimState;
  track: Track;
  humanId: string;
  /** Device pixel ratio already applied to the context transform. */
};

export function render({ ctx, width, height, state, track, humanId }: RenderOpts) {
  const human = state.racers.find((r) => r.id === humanId);
  // Shards are per-racer, so hide exactly the ones this player has taken.
  const myShards = state.claimedShards.get(humanId) ?? new Set<number>();
  const camY = human ? human.y : 0;
  const t = state.tick * TICK_DT;

  const scale = width / TRACK_WIDTH;
  const viewTop = camY + VIEW_AHEAD;
  const viewBottom = camY - VIEW_BEHIND;
  const span = viewTop - viewBottom;

  /** Track coords -> screen. y grows up-track, so screen y inverts. */
  const sx = (x: number) => x * scale;
  const sy = (y: number) => height - ((y - viewBottom) / span) * height;
  const sh = (len: number) => (len / span) * height;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  drawLanes(ctx, width, height, viewBottom, span, sy);
  drawFinish(ctx, width, track, sy);
  drawCheckpoints(ctx, width, track, viewBottom, viewTop, sy);
  drawObstacles(ctx, track, t, viewBottom, viewTop, sx, sy, sh, scale);
  drawShards(ctx, myShards, track, viewBottom, viewTop, sx, sy, scale, t);
  drawOrb(ctx, state, track, t, viewBottom, viewTop, sx, sy, scale);
  drawRacers(ctx, state, humanId, viewBottom, viewTop, sx, sy, scale, t);
  drawEdges(ctx, width, height);
}

function drawLanes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewBottom: number,
  span: number,
  sy: (y: number) => number,
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
}

function drawFinish(
  ctx: CanvasRenderingContext2D,
  width: number,
  track: Track,
  sy: (y: number) => number,
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
  ctx.shadowBlur = 26;
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
    } else {
      roundRect(ctx, x, py - boxH / 2, w, boxH, Math.min(5, boxH / 2));
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
}

function drawShards(
  ctx: CanvasRenderingContext2D,
  myShards: Set<number>,
  track: Track,
  viewBottom: number,
  viewTop: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  scale: number,
  t: number,
) {
  for (const s of track.shards) {
    if (myShards.has(s.id)) continue;
    if (s.y < viewBottom - 60 || s.y > viewTop + 60) continue;

    const px = sx(s.x);
    const py = sy(s.y);
    const r = 17 * scale + Math.sin(t * 3 + s.id) * 1.4;
    const color = s.isTrap ? COLORS.trap : COLORS.shard;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(t * 1.1 + s.id);

    ctx.shadowBlur = 20;
    ctx.shadowColor = color;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI / 3) * i;
      const px2 = Math.cos(a) * r;
      const py2 = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px2, py2);
      else ctx.lineTo(px2, py2);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // The number is the point — always upright, always legible.
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#04231a';
    ctx.font = `800 ${Math.round(15 * scale)}px ui-sans-serif, system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.number), px, py + 0.5);
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

  ctx.shadowBlur = 34;
  ctx.shadowColor = COLORS.orb;
  ctx.fillStyle = COLORS.orb;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = '#2b1a02';
  ctx.font = `800 ${Math.round(17 * scale)}px ui-sans-serif, system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(orb.bonusball), px, py + 0.5);
  ctx.textBaseline = 'alphabetic';
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
) {
  let rivalIdx = 0;

  for (const r of state.racers) {
    const isHuman = r.id === humanId;
    const color = isHuman ? COLORS.player : RIVAL_HUES[rivalIdx++ % RIVAL_HUES.length];

    if (r.y < viewBottom - 80 || r.y > viewTop + 80) {
      if (!isHuman) drawOffscreenPip(ctx, r, viewBottom, viewTop, sx, sy, color);
      continue;
    }

    const px = sx(r.x);
    const py = sy(r.y);
    const rad = PLAYER_RADIUS * scale;

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

    if (r.hasOrb) {
      ctx.strokeStyle = COLORS.orb;
      ctx.lineWidth = 2.5;
      ctx.shadowBlur = 14;
      ctx.shadowColor = COLORS.orb;
      ctx.beginPath();
      ctx.arc(px, py, rad + 6, 0, Math.PI * 2);
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
  viewBottom: number,
  viewTop: number,
  sx: (x: number) => number,
  sy: (y: number) => number,
  color: string,
) {
  const ahead = r.y > viewTop;
  const py = ahead ? 14 : sy(viewBottom) - 14;
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
