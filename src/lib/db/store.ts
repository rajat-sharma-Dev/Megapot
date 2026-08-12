/**
 * Persistence.
 *
 * A JSON-file store behind a narrow async interface. Chosen deliberately over
 * Supabase for the jam: zero external setup means the app runs and tests
 * end-to-end on a clean checkout with no credentials. Every function here is
 * async and the shapes are relational, so swapping in Postgres later is a
 * driver change, not a rewrite.
 *
 * USDC amounts are stored as decimal strings of 6-decimal base units, never as
 * numbers — a float cannot hold these exactly and this money buys real tickets.
 */

import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import { vaultDayKey, windowForKey } from '../vault/day';

export type Player = {
  id: string; // lowercased wallet address
  name: string;
  /** Spendable balance, in USDC base units (6dp), as a decimal string. */
  credits: string;
  lifetimePoints: number;
  racesCompleted: number;
  /** Races the player bailed out of. Shown on the profile, not punished further. */
  racesRetired: number;
  bestRaceScore: number;
  totalStolen: number; // for the "Most Feared Racer" board
  ticketsEarned: number;
  /** Last vault day on which the free-entry grant was applied. */
  lastGrantDay: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RaceRecord = {
  id: string;
  seed: number;
  playerId: string;
  /** What the player paid to enter, in base units. */
  entryFeeUnits: string;
  /** Vault day this race counts toward. */
  dayKey: string;
  rolloverCount: number;
  createdAt: string;
  /** Set once the result is submitted; prevents replaying one race for points. */
  settledAt: string | null;
  placement: number | null;
  pointsAwarded: number | null;
  retired: boolean | null;
};

export type TicketRecord = {
  id: string;
  playerId: string;
  txHash: string;
  drawingId: string;
  /** Tickets bought in this transaction. */
  count: number;
  /** The vault day whose pool paid for it. */
  dayKey: string;
  /** Where the player finished on that day's ladder. */
  rank: number;
  points: number;
  network: string;
  createdAt: string;
};

/** One player's standing on one day's ladder. */
export type LadderEntry = {
  playerId: string;
  name: string;
  points: number;
  races: number;
  retired: number;
  bestScore: number;
  updatedAt: string;
};

export type DayAllocation = {
  playerId: string;
  name: string;
  rank: number;
  points: number;
  tickets: number;
  txHash: string | null;
  error: string | null;
};

export type DaySettlement = {
  settledAt: string;
  ticketPriceUnits: string;
  drawingId: string;
  totalPoolUnits: string;
  ticketsBought: number;
  carryOutUnits: string;
  allocations: DayAllocation[];
};

export type VaultDay = {
  key: string;
  opensAt: string;
  closesAt: string;
  /** Carried over from the previous day's unspent remainder. */
  carryInUnits: string;
  /** Entry fees collected today, including the carry-in. */
  poolUnits: string;
  entries: number;
  settlement: DaySettlement | null;
};

type DbShape = {
  players: Record<string, Player>;
  races: Record<string, RaceRecord>;
  tickets: TicketRecord[];
  days: Record<string, VaultDay>;
  /** dayKey -> playerId -> standing */
  ladder: Record<string, Record<string, LadderEntry>>;
  /** Consecutive races where the Jackpot Orb went unclaimed — it stacks. */
  orbRollover: number;
};

const DATA_DIR = process.env.RALLY_DATA_DIR || path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'rally-vault.json');

const EMPTY: DbShape = {
  players: {},
  races: {},
  tickets: [],
  days: {},
  ladder: {},
  orbRollover: 0,
};

/**
 * Cached across hot reloads in dev. Writes are serialised through a promise
 * chain so concurrent requests can't interleave a read-modify-write.
 *
 * The key carries a schema version, and that is load bearing: the cache lives on
 * `globalThis`, so it survives the module re-evaluation that a hot reload does.
 * Without a version, editing this file leaves the previous shape's rows sitting
 * in memory, un-hydrated, and the dev server keeps serving them until someone
 * thinks to restart it. Bump this whenever the persisted shape changes.
 */
const CACHE_KEY = '__rallyDb_v2';

const g = globalThis as unknown as Record<string, unknown> & {
  __rallyWriteQueue?: Promise<void>;
};

const cached = () => g[CACHE_KEY] as DbShape | undefined;
const setCached = (db: DbShape) => { g[CACHE_KEY] = db; };

/**
 * Parse a persisted USDC amount.
 *
 * Money is stored as a decimal string of base units, but this file can predate
 * the field entirely, so a bare `BigInt(value)` on it throws
 * "Cannot convert undefined to a BigInt" — which is exactly what a stale data
 * file did on the first race after the schema changed. Anything unparseable
 * reads as zero rather than taking down the request.
 */
export const toUnits = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return 0n;
};

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Fill in every field a Player is supposed to have.
 *
 * The store is a JSON file on disk, so it survives deploys and schema changes and
 * will happily hand back rows written by an older version of this code. Reading
 * is therefore the right place to reconcile shape — every code path downstream
 * gets a complete record and no caller has to defend itself. Unknown legacy keys
 * are left alone rather than dropped, so nothing is silently destroyed.
 */
function hydratePlayer(raw: Partial<Player> & { id: string }): Player {
  return {
    ...raw,
    id: raw.id,
    name: raw.name || `Racer ${raw.id.slice(2, 6).toUpperCase()}`,
    credits: toUnits(raw.credits).toString(),
    lifetimePoints: int(raw.lifetimePoints),
    racesCompleted: int(raw.racesCompleted),
    racesRetired: int(raw.racesRetired),
    bestRaceScore: int(raw.bestRaceScore),
    totalStolen: int(raw.totalStolen),
    ticketsEarned: int(raw.ticketsEarned),
    lastGrantDay: typeof raw.lastGrantDay === 'string' ? raw.lastGrantDay : null,
    createdAt: raw.createdAt || now(),
    updatedAt: raw.updatedAt || now(),
  };
}

async function load(): Promise<DbShape> {
  const hit = cached();
  if (hit) return hit;

  let parsed: Partial<DbShape> = {};
  try {
    parsed = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
  } catch {
    // No file yet, or unreadable — start clean.
  }

  const db: DbShape = { ...structuredClone(EMPTY), ...parsed };

  // Reconcile anything written by an earlier schema.
  for (const [id, raw] of Object.entries(db.players ?? {})) {
    db.players[id] = hydratePlayer({ ...(raw as Partial<Player>), id });
  }
  for (const day of Object.values(db.days ?? {})) {
    day.poolUnits = toUnits(day.poolUnits).toString();
    day.carryInUnits = toUnits(day.carryInUnits).toString();
    day.entries = int(day.entries);
  }
  if (!Array.isArray(db.tickets)) db.tickets = [];

  setCached(db);
  return db;
}

async function persist(): Promise<void> {
  const db = cached();
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
      credits: '0',
      lifetimePoints: 0,
      racesCompleted: 0,
      racesRetired: 0,
      bestRaceScore: 0,
      totalStolen: 0,
      ticketsEarned: 0,
      lastGrantDay: null,
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

/** Move credits. `delta` may be negative; the balance is never left below zero. */
export async function adjustCredits(id: string, delta: bigint): Promise<bigint> {
  const db = await load();
  const key = normalizeAddress(id);
  const p = db.players[key];
  if (!p) throw new Error(`Unknown player ${key}`);

  const next = toUnits(p.credits) + delta;
  if (next < 0n) throw new Error('Insufficient credits');

  p.credits = next.toString();
  p.updatedAt = now();
  await persist();
  return next;
}

// ─── Vault days ─────────────────────────────────────────────────────────────

/**
 * Fetch (or open) a day.
 *
 * A new day inherits the previous day's unspent remainder, so a quiet Tuesday
 * that only raised half a ticket's worth of fees rolls that value forward
 * instead of losing it.
 */
export async function getOrCreateDay(key: string): Promise<VaultDay> {
  const db = await load();
  if (db.days[key]) return db.days[key];

  const w = windowForKey(key);

  // Carry in from the most recent settled day before this one.
  const prior = Object.values(db.days)
    .filter((d) => d.key < key && d.settlement)
    .sort((a, b) => b.key.localeCompare(a.key))[0];
  const carryIn = prior?.settlement ? toUnits(prior.settlement.carryOutUnits) : 0n;

  db.days[key] = {
    key,
    opensAt: w.opensAt,
    closesAt: w.closesAt,
    carryInUnits: carryIn.toString(),
    poolUnits: carryIn.toString(),
    entries: 0,
    settlement: null,
  };
  await persist();
  return db.days[key];
}

export async function getDay(key: string): Promise<VaultDay | null> {
  const db = await load();
  return db.days[key] ?? null;
}

export async function listDays(): Promise<VaultDay[]> {
  const db = await load();
  return Object.values(db.days).sort((a, b) => b.key.localeCompare(a.key));
}

/** Days that have closed but never been settled, oldest first. */
export async function listUnsettledDays(before: string): Promise<VaultDay[]> {
  const db = await load();
  return Object.values(db.days)
    .filter((d) => !d.settlement && d.key < before)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export async function addEntryFee(key: string, feeUnits: bigint): Promise<VaultDay> {
  const db = await load();
  const day = db.days[key] ?? (await getOrCreateDay(key));
  day.poolUnits = (toUnits(day.poolUnits) + feeUnits).toString();
  day.entries += 1;
  await persist();
  return day;
}

export async function markDaySettled(key: string, settlement: DaySettlement): Promise<VaultDay> {
  const db = await load();
  const day = db.days[key];
  if (!day) throw new Error(`Unknown vault day ${key}`);
  day.settlement = settlement;
  await persist();
  return day;
}

// ─── Daily ladder ───────────────────────────────────────────────────────────

export async function addLadderPoints(
  dayKey: string,
  player: { id: string; name: string },
  points: number,
  retired: boolean,
): Promise<LadderEntry> {
  const db = await load();
  const pid = normalizeAddress(player.id);
  const board = (db.ladder[dayKey] ??= {});

  const entry = (board[pid] ??= {
    playerId: pid,
    name: player.name,
    points: 0,
    races: 0,
    retired: 0,
    bestScore: 0,
    updatedAt: now(),
  });

  entry.name = player.name;
  entry.points += points;
  entry.races += 1;
  if (retired) entry.retired += 1;
  entry.bestScore = Math.max(entry.bestScore, points);
  entry.updatedAt = now();

  await persist();
  return entry;
}

/** One day's ladder, ranked. Ties break by address so the order is stable. */
export async function getLadder(dayKey: string): Promise<LadderEntry[]> {
  const db = await load();
  return Object.values(db.ladder[dayKey] ?? {}).sort(
    (a, b) => b.points - a.points || a.playerId.localeCompare(b.playerId),
  );
}

export async function getLadderEntry(dayKey: string, playerId: string): Promise<LadderEntry | null> {
  const db = await load();
  return db.ladder[dayKey]?.[normalizeAddress(playerId)] ?? null;
}

// ─── Races ──────────────────────────────────────────────────────────────────

export async function createRace(
  r: Omit<RaceRecord, 'createdAt' | 'settledAt' | 'placement' | 'pointsAwarded' | 'retired'>,
): Promise<RaceRecord> {
  const db = await load();
  const rec: RaceRecord = {
    ...r,
    playerId: normalizeAddress(r.playerId),
    createdAt: now(),
    settledAt: null,
    placement: null,
    pointsAwarded: null,
    retired: null,
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
  patch: { placement: number; pointsAwarded: number; retired: boolean },
): Promise<RaceRecord> {
  const db = await load();
  const race = db.races[id];
  if (!race) throw new Error(`Unknown race ${id}`);
  race.settledAt = now();
  race.placement = patch.placement;
  race.pointsAwarded = patch.pointsAwarded;
  race.retired = patch.retired;
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
  setCached(structuredClone(EMPTY));
  await persist();
}

export { vaultDayKey };
