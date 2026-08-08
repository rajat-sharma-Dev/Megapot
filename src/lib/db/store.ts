/**
 * Persistence.
 *
 * A JSON-file store behind a narrow async interface. Chosen deliberately over
 * Supabase for the jam: zero external setup means the app runs and tests
 * end-to-end on a clean checkout with no credentials. Every function here is
 * async and the shapes are relational, so swapping in Postgres later is a
 * driver change, not a rewrite.
 */

import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { ScoreBreakdown } from '../points/scoring';

export type Player = {
  id: string; // lowercased wallet address
  name: string;
  pointBank: number; // progress toward the next ticket
  lifetimePoints: number;
  racesCompleted: number;
  /** Cumulative Cookie pieces ever earned (1 per 3 races). */
  cookiePieces: number;
  /** Completed Cookies already paid out, so a rebuild can't double-award. */
  cookiesAwarded: number;
  totalStolen: number; // for the "Most Feared Racer" board
  ticketsEarned: number;
  createdAt: string;
  updatedAt: string;
};

export type RaceRecord = {
  id: string;
  seed: number;
  playerId: string;
  ballMax: number;
  bonusballMax: number;
  rolloverCount: number;
  createdAt: string;
  /** Set once the result is submitted; prevents replaying one race for points. */
  settledAt: string | null;
  placement: number | null;
  pointsAwarded: number | null;
};

export type TicketRecord = {
  id: string;
  playerId: string;
  txHash: string;
  drawingId: string;
  normals: number[];
  bonusball: number;
  earnedNormals: number[];
  filledNormals: number[];
  bonusballEarned: boolean;
  path: 'point_bank' | 'cookie';
  network: string;
  createdAt: string;
  /** Set when the chain was unavailable and the ticket is awaiting retry. */
  pending?: boolean;
};

type DbShape = {
  players: Record<string, Player>;
  races: Record<string, RaceRecord>;
  tickets: TicketRecord[];
  /** Consecutive races where the Golden Orb went unclaimed — it stacks. */
  orbRollover: number;
};

const DATA_DIR = process.env.RALLY_DATA_DIR || path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'rally-vault.json');

const EMPTY: DbShape = { players: {}, races: {}, tickets: [], orbRollover: 0 };

/**
 * Cached across hot reloads in dev. Writes are serialised through a promise
 * chain so concurrent requests can't interleave a read-modify-write.
 */
const g = globalThis as unknown as {
  __rallyDb?: DbShape;
  __rallyWriteQueue?: Promise<void>;
};

async function load(): Promise<DbShape> {
  if (g.__rallyDb) return g.__rallyDb;
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    g.__rallyDb = { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    g.__rallyDb = structuredClone(EMPTY);
  }
  return g.__rallyDb!;
}

async function persist(): Promise<void> {
  const db = g.__rallyDb;
  if (!db) return;
  g.__rallyWriteQueue = (g.__rallyWriteQueue ?? Promise.resolve()).then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
    await fs.rename(tmp, DB_FILE); // atomic swap — never a half-written file
  });
  return g.__rallyWriteQueue;
}

const now = () => new Date().toISOString();
export const normalizeAddress = (a: string) => a.trim().toLowerCase();

// ─── Players ────────────────────────────────────────────────────────────────

export async function getOrCreatePlayer(address: string, name?: string): Promise<Player> {
  const db = await load();
  const id = normalizeAddress(address);
  if (!db.players[id]) {
    db.players[id] = {
      id,
      name: name || `Racer ${id.slice(2, 6).toUpperCase()}`,
      pointBank: 0,
      lifetimePoints: 0,
      racesCompleted: 0,
      cookiePieces: 0,
      cookiesAwarded: 0,
      totalStolen: 0,
      ticketsEarned: 0,
      createdAt: now(),
      updatedAt: now(),
    };
    await persist();
  } else if (name && db.players[id].name !== name) {
    db.players[id].name = name;
    db.players[id].updatedAt = now();
    await persist();
  }
  return db.players[id];
}

export async function getPlayer(address: string): Promise<Player | null> {
  const db = await load();
  return db.players[normalizeAddress(address)] ?? null;
}

export async function updatePlayer(id: string, patch: Partial<Player>): Promise<Player> {
  const db = await load();
  const key = normalizeAddress(id);
  const existing = db.players[key];
  if (!existing) throw new Error(`Unknown player ${key}`);
  db.players[key] = { ...existing, ...patch, id: key, updatedAt: now() };
  await persist();
  return db.players[key];
}

export async function listPlayers(): Promise<Player[]> {
  const db = await load();
  return Object.values(db.players);
}

// ─── Races ──────────────────────────────────────────────────────────────────

export async function createRace(r: Omit<RaceRecord, 'createdAt' | 'settledAt' | 'placement' | 'pointsAwarded'>): Promise<RaceRecord> {
  const db = await load();
  const rec: RaceRecord = {
    ...r,
    playerId: normalizeAddress(r.playerId),
    createdAt: now(),
    settledAt: null,
    placement: null,
    pointsAwarded: null,
  };
  db.races[rec.id] = rec;
  await persist();
  return rec;
}

export async function getRace(id: string): Promise<RaceRecord | null> {
  const db = await load();
  return db.races[id] ?? null;
}

export async function settleRace(
  id: string,
  patch: { placement: number; pointsAwarded: number },
): Promise<RaceRecord> {
  const db = await load();
  const race = db.races[id];
  if (!race) throw new Error(`Unknown race ${id}`);
  race.settledAt = now();
  race.placement = patch.placement;
  race.pointsAwarded = patch.pointsAwarded;
  await persist();
  return race;
}

// ─── Orb rollover ───────────────────────────────────────────────────────────

export async function getOrbRollover(): Promise<number> {
  return (await load()).orbRollover;
}

export async function bumpOrbRollover(claimed: boolean): Promise<number> {
  const db = await load();
  db.orbRollover = claimed ? 0 : db.orbRollover + 1;
  await persist();
  return db.orbRollover;
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export async function recordTicket(t: Omit<TicketRecord, 'createdAt'>): Promise<TicketRecord> {
  const db = await load();
  const rec: TicketRecord = { ...t, playerId: normalizeAddress(t.playerId), createdAt: now() };
  db.tickets.push(rec);
  await persist();
  return rec;
}

export async function listTickets(playerId?: string): Promise<TicketRecord[]> {
  const db = await load();
  const all = [...db.tickets].reverse();
  return playerId ? all.filter((t) => t.playerId === normalizeAddress(playerId)) : all;
}

// ─── Test support ───────────────────────────────────────────────────────────

/** Wipe everything. Used by the end-to-end harness; never called by the app. */
export async function __resetForTests(): Promise<void> {
  g.__rallyDb = structuredClone(EMPTY);
  await persist();
}

export type ScoreBreakdownRecord = ScoreBreakdown;
