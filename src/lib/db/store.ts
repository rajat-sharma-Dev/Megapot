/**
 * Persistence.
 *
 * A JSON-file store behind a narrow async interface. Chosen deliberately over a
 * hosted database for the jam: zero external setup means the app runs and tests
 * end-to-end on a clean checkout with no credentials. Every function here is
 * async and the shapes are relational, so swapping in Postgres later is a driver
 * change, not a rewrite.
 *
 * USDC amounts are stored as decimal strings of 6-decimal base units, never as
 * numbers — a float cannot hold these exactly and this money buys real tickets.
 */

import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { InputLog } from '../game/replay';
import type { BotSkill } from '../game/bots';
import type { ScoreBreakdown } from '../points/scoring';
import * as pg from './pg';

// ─── Shapes ─────────────────────────────────────────────────────────────────

export type Player = {
  id: string; // lowercased wallet address
  name: string;
  /**
   * Spendable balance, in USDC base units. Funded by real deposits and spent on
   * entry fees.
   */
  creditsUnits: string;
  /**
   * Legacy field, retained only so old rows still parse.
   *
   * Winnings used to accumulate here toward a ticket. They no longer do — a pot
   * buys a ticket outright, and anything short of one is refunded to
   * `creditsUnits`. Any balance left in here is folded into credits on load, so
   * nobody's winnings are stranded by the change.
   */
  vaultUnits: string;

  lifetimeDepositedUnits: string;
  lifetimeWithdrawnUnits: string;
  lifetimeWageredUnits: string;
  lifetimeWonUnits: string;

  racesPlayed: number;
  racesWon: number;
  racesRetired: number;
  lifetimePoints: number;
  bestRaceScore: number;
  totalStolen: number;
  ticketsEarned: number;

  createdAt: string;
  updatedAt: string;
};

export type SeatKind = 'human' | 'bot' | 'empty';

export type SeatRecord = {
  index: number;
  kind: SeatKind;
  /** Wallet address for a human seat, `house_<i>` for a bot, '' while empty. */
  id: string;
  name: string;
  skill?: BotSkill;
  botSeed?: number;
  /** True once this seat's entry fee is in the pot. */
  staked: boolean;
  joinedAt: string | null;
  submittedAt: string | null;
  /**
   * The submitted run. Kept only until the lobby settles and then pruned — an
   * input log is ~4,000 numbers and there is no reason to carry five of them
   * per race forever.
   */
  inputs: InputLog | null;
  points: number | null;
  placement: number | null;
  retired: boolean | null;
  breakdown: ScoreBreakdown | null;
};

export type LobbyState = 'open' | 'locked' | 'settled';

export type StandingRow = {
  index: number;
  id: string;
  name: string;
  kind: 'human' | 'bot';
  points: number;
  placement: number;
  retired: boolean;
  progress: number;
  isWinner: boolean;
};

export type LobbySettlement = {
  settledAt: string;
  winnerSeat: number | null;
  winnerId: string | null;
  winnerName: string | null;
  winnerKind: 'human' | 'bot' | null;
  potUnits: string;
  stakedSeats: number;
  /** True when a house seat outscored every human and the pot went back. */
  houseWins: boolean;
  /** True when nobody scored, so every stake was returned. */
  refunded: boolean;
  standings: StandingRow[];
  /** Whole tickets the winner's vault could afford immediately after the win. */
  ticketsMinted: number;
  txHashes: string[];
  mintError: string | null;
};

export type Lobby = {
  id: string;
  seed: number;
  state: LobbyState;
  createdAt: string;
  /** When an under-filled lobby stops waiting and fills with house seats. */
  fillDeadline: string;
  /** When a locked lobby settles regardless of who hasn't driven yet. */
  submitDeadline: string | null;
  entryFeeUnits: string;
  ticketPriceUnits: string;
  drawingId: string;
  rolloverCount: number;
  seats: SeatRecord[];
  settlement: LobbySettlement | null;
};

export type TicketRecord = {
  id: string;
  playerId: string;
  txHash: string;
  drawingId: string;
  count: number;
  /** The lobby whose pot paid for it. */
  lobbyId: string | null;
  network: string;
  /**
   * True when MEGAPOT_DRY_RUN was on and nothing was broadcast.
   *
   * Recorded per ticket rather than read from the environment at display time,
   * because the flag can be flipped between a purchase and someone looking at
   * it — and a simulated ticket must never later present itself as real.
   */
  simulated: boolean;
  /** Protocol-assigned ticket ids. Empty for a simulated purchase. */
  ticketIds: string[];
  createdAt: string;
};

export type LedgerKind = 'deposit' | 'withdrawal' | 'entry' | 'win' | 'refund' | 'ticket';

export type LedgerEntry = {
  id: string;
  playerId: string;
  kind: LedgerKind;
  /** Signed, in base units: positive credits the player, negative debits them. */
  deltaUnits: string;
  /** On-chain hash for deposits and withdrawals, null for internal movements. */
  txHash: string | null;
  lobbyId: string | null;
  note: string | null;
  createdAt: string;
};

type DbShape = {
  players: Record<string, Player>;
  lobbies: Record<string, Lobby>;
  tickets: TicketRecord[];
  ledger: LedgerEntry[];
  /**
   * The house float — the bankroll that stakes bot seats.
   *
   * Bot seats are not a subsidy. The house stakes an entry fee like everyone
   * else and keeps the pot when one of its seats outscores every human, so a
   * solo player is genuinely playing against something rather than against a
   * mirror. The float can run dry, and when it does bot seats stop staking.
   */
  houseFloatUnits: string;
  /** Consecutive races where the Jackpot Orb went unclaimed — it stacks. */
  orbRollover: number;
};

const DATA_DIR = process.env.RALLY_DATA_DIR || path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'rally-vault.json');

/** Seeded once, on a fresh database, so the very first solo race has an opponent. */
const HOUSE_FLOAT_SEED = process.env.RALLY_HOUSE_FLOAT ?? '2000000'; // $2.00

const EMPTY: DbShape = {
  players: {},
  lobbies: {},
  tickets: [],
  ledger: [],
  houseFloatUnits: HOUSE_FLOAT_SEED,
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
const CACHE_KEY = '__rallyDb_v3';

const g = globalThis as unknown as Record<string, unknown> & {
  __rallyWriteQueue?: Promise<void>;
};

const cached = () => g[CACHE_KEY] as DbShape | undefined;
const setCached = (db: DbShape) => {
  g[CACHE_KEY] = db;
};

/**
 * Parse a persisted USDC amount.
 *
 * Money is stored as a decimal string of base units, but this file outlives
 * schema changes and can predate a field entirely, so a bare `BigInt(value)` on
 * it throws "Cannot convert undefined to a BigInt". Anything unparseable reads
 * as zero rather than taking down the request.
 */
export const toUnits = (v: unknown): bigint => {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v);
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return 0n;
};

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const now = () => new Date().toISOString();

export const normalizeAddress = (a: string) => a.trim().toLowerCase();

/**
 * Fill in every field a Player is supposed to have.
 *
 * The store is a JSON file on disk, so it survives deploys and schema changes
 * and will happily hand back rows written by an older version of this code.
 * Reading is therefore the right place to reconcile shape — every code path
 * downstream gets a complete record and no caller has to defend itself. Unknown
 * legacy keys are left alone rather than dropped, so nothing is silently
 * destroyed.
 */
function hydratePlayer(raw: Partial<Player> & { id: string; credits?: unknown }): Player {
  return {
    ...raw,
    id: raw.id,
    name: raw.name || `Racer ${raw.id.slice(2, 6).toUpperCase()}`,
    // `credits` was the field name before deposits became real money.
    /**
     * Legacy balances are folded forward, not dropped.
     *
     * `credits` was the field name before deposits became real money, and
     * `vaultUnits` held winnings that used to accumulate toward a ticket. Pots
     * now buy tickets outright, so anything left in the old vault is added to
     * the spendable balance — the alternative is silently stranding money
     * somebody won.
     */
    creditsUnits: (
      toUnits(raw.creditsUnits ?? raw.credits) + toUnits(raw.vaultUnits)
    ).toString(),
    vaultUnits: '0',
    lifetimeDepositedUnits: toUnits(raw.lifetimeDepositedUnits).toString(),
    lifetimeWithdrawnUnits: toUnits(raw.lifetimeWithdrawnUnits).toString(),
    lifetimeWageredUnits: toUnits(raw.lifetimeWageredUnits).toString(),
    lifetimeWonUnits: toUnits(raw.lifetimeWonUnits).toString(),
    racesPlayed: int(raw.racesPlayed),
    racesWon: int(raw.racesWon),
    racesRetired: int(raw.racesRetired),
    lifetimePoints: int(raw.lifetimePoints),
    bestRaceScore: int(raw.bestRaceScore),
    totalStolen: int(raw.totalStolen),
    ticketsEarned: int(raw.ticketsEarned),
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

  for (const [id, raw] of Object.entries(db.players ?? {})) {
    db.players[id] = hydratePlayer({ ...(raw as Partial<Player>), id });
  }
  if (!Array.isArray(db.tickets)) db.tickets = [];
  if (!Array.isArray(db.ledger)) db.ledger = [];
  if (!db.lobbies || typeof db.lobbies !== 'object') db.lobbies = {};
  db.houseFloatUnits = toUnits(db.houseFloatUnits ?? HOUSE_FLOAT_SEED).toString();
  db.orbRollover = int(db.orbRollover);

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

/** Flush pending mutations. Callers that mutate a Lobby in place call this. */
const file_save = persist;

// ─── Players ────────────────────────────────────────────────────────────────

async function file_getOrCreatePlayer(address: string, name?: string): Promise<Player> {
  const db = await load();
  const id = normalizeAddress(address);

  if (!db.players[id]) {
    db.players[id] = hydratePlayer({ id, name: name || `Racer ${id.slice(2, 6).toUpperCase()}` });
    await persist();
  } else if (name && db.players[id].name !== name) {
    db.players[id].name = name;
    db.players[id].updatedAt = now();
    await persist();
  }
  return db.players[id];
}

async function file_getPlayer(address: string): Promise<Player | null> {
  const db = await load();
  return db.players[normalizeAddress(address)] ?? null;
}

async function file_updatePlayer(id: string, patch: Partial<Player>): Promise<Player> {
  const db = await load();
  const key = normalizeAddress(id);
  const existing = db.players[key];
  if (!existing) throw new Error(`Unknown player ${key}`);
  db.players[key] = { ...existing, ...patch, id: key, updatedAt: now() };
  await persist();
  return db.players[key];
}

async function file_listPlayers(): Promise<Player[]> {
  const db = await load();
  return Object.values(db.players);
}

/**
 * Move money on a player's balance and write the ledger row in the same step.
 *
 * Deliberately one function rather than two: an adjustment without a ledger row
 * is money that appears from nowhere, and this is the only place either can
 * happen. `field` is retained from when there were two balances; everything
 * moves through `creditsUnits` now.
 */
async function file_adjustBalance(opts: {
  playerId: string;
  field: 'creditsUnits' | 'vaultUnits';
  deltaUnits: bigint;
  kind: LedgerKind;
  txHash?: string | null;
  lobbyId?: string | null;
  note?: string | null;
}): Promise<Player> {
  const db = await load();
  const key = normalizeAddress(opts.playerId);
  const p = db.players[key];
  if (!p) throw new Error(`Unknown player ${key}`);

  const next = toUnits(p[opts.field]) + opts.deltaUnits;
  if (next < 0n) {
    throw new Error(
      `Insufficient ${opts.field === 'creditsUnits' ? 'balance' : 'vault'}: ` +
        `have ${p[opts.field]}, need ${-opts.deltaUnits} base units`,
    );
  }

  p[opts.field] = next.toString();
  p.updatedAt = now();

  db.ledger.push({
    id: `${Date.now().toString(36)}-${db.ledger.length}`,
    playerId: key,
    kind: opts.kind,
    deltaUnits: opts.deltaUnits.toString(),
    txHash: opts.txHash ?? null,
    lobbyId: opts.lobbyId ?? null,
    note: opts.note ?? null,
    createdAt: now(),
  });

  await persist();
  return p;
}

async function file_listLedger(playerId?: string, limit = 50): Promise<LedgerEntry[]> {
  const db = await load();
  const all = [...db.ledger].reverse();
  const filtered = playerId ? all.filter((e) => e.playerId === normalizeAddress(playerId)) : all;
  return filtered.slice(0, limit);
}

/**
 * Has this on-chain transaction already been credited?
 *
 * The deposit route is the one place a user can make us create money, so it has
 * to be idempotent against a replayed request. The transaction hash is the
 * natural idempotency key.
 */
async function file_ledgerHasTx(txHash: string): Promise<boolean> {
  const db = await load();
  const h = txHash.toLowerCase();
  return db.ledger.some((e) => e.txHash?.toLowerCase() === h);
}

// ─── House float ────────────────────────────────────────────────────────────

async function file_getHouseFloat(): Promise<bigint> {
  return toUnits((await load()).houseFloatUnits);
}

/**
 * Move the house float. Refuses to go negative, which is what stops the house
 * from staking seats it cannot cover.
 */
async function file_adjustHouseFloat(deltaUnits: bigint): Promise<bigint> {
  const db = await load();
  const next = toUnits(db.houseFloatUnits) + deltaUnits;
  if (next < 0n) throw new Error('House float cannot cover this stake');
  db.houseFloatUnits = next.toString();
  await persist();
  return next;
}

// ─── Lobbies ────────────────────────────────────────────────────────────────

async function file_createLobby(lobby: Lobby): Promise<Lobby> {
  const db = await load();
  db.lobbies[lobby.id] = lobby;
  await persist();
  return lobby;
}

async function file_getLobby(id: string): Promise<Lobby | null> {
  const db = await load();
  return db.lobbies[id] ?? null;
}

/**
 * The lobby a new player should join: still open, still has an empty seat, and
 * hasn't already been sitting past its fill deadline. Oldest first, so players
 * pile into the lobby closest to starting rather than each opening their own.
 */
async function file_findJoinableLobby(nowMs: number): Promise<Lobby | null> {
  const db = await load();
  return (
    Object.values(db.lobbies)
      .filter(
        (l) =>
          l.state === 'open' &&
          l.seats.some((s) => s.kind === 'empty') &&
          new Date(l.fillDeadline).getTime() > nowMs,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] ?? null
  );
}

/** Lobbies that are due to be locked or settled, so a request can advance them. */
async function file_listPendingLobbies(): Promise<Lobby[]> {
  const db = await load();
  return Object.values(db.lobbies)
    .filter((l) => l.state !== 'settled')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function file_listLobbiesForPlayer(playerId: string, limit = 20): Promise<Lobby[]> {
  const db = await load();
  const id = normalizeAddress(playerId);
  return Object.values(db.lobbies)
    .filter((l) => l.seats.some((s) => s.id === id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

async function file_listRecentSettledLobbies(limit = 12): Promise<Lobby[]> {
  const db = await load();
  return Object.values(db.lobbies)
    .filter((l) => l.state === 'settled')
    .sort((a, b) => (b.settlement?.settledAt ?? '').localeCompare(a.settlement?.settledAt ?? ''))
    .slice(0, limit);
}

// ─── Orb rollover ───────────────────────────────────────────────────────────

async function file_getOrbRollover(): Promise<number> {
  return (await load()).orbRollover;
}

async function file_bumpOrbRollover(claimed: boolean): Promise<number> {
  const db = await load();
  db.orbRollover = claimed ? 0 : db.orbRollover + 1;
  await persist();
  return db.orbRollover;
}

// ─── Tickets ────────────────────────────────────────────────────────────────

async function file_recordTicket(t: Omit<TicketRecord, 'createdAt'>): Promise<TicketRecord> {
  const db = await load();
  const rec: TicketRecord = { ...t, playerId: normalizeAddress(t.playerId), createdAt: now() };
  db.tickets.push(rec);
  await persist();
  return rec;
}

async function file_listTickets(playerId?: string): Promise<TicketRecord[]> {
  const db = await load();
  const all = [...db.tickets].reverse();
  return playerId ? all.filter((t) => t.playerId === normalizeAddress(playerId)) : all;
}

// ─── Test support ───────────────────────────────────────────────────────────

/** Wipe everything. Used by the end-to-end harness; never called by the app. */
async function file___resetForTests(): Promise<void> {
  setCached(structuredClone(EMPTY));
  await persist();
}


// ─── Backend selection ──────────────────────────────────────────────────────

/**
 * One store, two backends.
 *
 * The JSON file is the default and exists so a clean checkout runs with no
 * credentials at all — clone, `npm run dev`, play. It is also unusable on any
 * real deployment: Vercel's filesystem is read-only, and even in /tmp each
 * instance keeps its own copy, so a balance credited on one request disappears
 * on the next.
 *
 * So the moment `DATABASE_URL` exists we use Postgres instead. Nothing above
 * this line knows which is active, and the choice is made per call rather than
 * cached at import time, so a build that has no database at build time and one
 * at runtime behaves correctly.
 */
// Named `pgEnabled`, not `usePg` — anything starting with `use` is treated as a
// React hook by the lint rules, and these are plain server functions.
const pgEnabled = () => pg.hasPostgres();

export const save = async (lobby?: Lobby): Promise<void> => {
  // The file store writes everything at once; Postgres needs to know what
  // changed. Callers that mutate a lobby pass it.
  if (pgEnabled()) {
    if (lobby) await pg.saveLobby(lobby);
    return;
  }
  await file_save();
};

export const getOrCreatePlayer = (a: string, n?: string) =>
  pgEnabled() ? pg.getOrCreatePlayer(a, n) : file_getOrCreatePlayer(a, n);
export const getPlayer = (a: string) => (pgEnabled() ? pg.getPlayer(a) : file_getPlayer(a));
export const updatePlayer = (id: string, patch: Partial<Player>) =>
  pgEnabled() ? pg.updatePlayer(id, patch) : file_updatePlayer(id, patch);
export const listPlayers = () => (pgEnabled() ? pg.listPlayers() : file_listPlayers());

export const adjustBalance = (o: Parameters<typeof file_adjustBalance>[0]) =>
  pgEnabled() ? pg.adjustBalance(o) : file_adjustBalance(o);
export const listLedger = (p?: string, l = 50) =>
  pgEnabled() ? pg.listLedger(p, l) : file_listLedger(p, l);
export const ledgerHasTx = (tx: string) => (pgEnabled() ? pg.ledgerHasTx(tx) : file_ledgerHasTx(tx));

export const getHouseFloat = () => (pgEnabled() ? pg.getHouseFloat() : file_getHouseFloat());
export const adjustHouseFloat = (d: bigint) =>
  pgEnabled() ? pg.adjustHouseFloat(d) : file_adjustHouseFloat(d);
export const getOrbRollover = () => (pgEnabled() ? pg.getOrbRollover() : file_getOrbRollover());
export const bumpOrbRollover = (c: boolean) =>
  pgEnabled() ? pg.bumpOrbRollover(c) : file_bumpOrbRollover(c);

export const createLobby = (l: Lobby) => (pgEnabled() ? pg.createLobby(l) : file_createLobby(l));
export const getLobby = (id: string) => (pgEnabled() ? pg.getLobby(id) : file_getLobby(id));
export const findJoinableLobby = (n: number) =>
  pgEnabled() ? pg.findJoinableLobby(n) : file_findJoinableLobby(n);
export const listPendingLobbies = () =>
  pgEnabled() ? pg.listPendingLobbies() : file_listPendingLobbies();
export const listLobbiesForPlayer = (p: string, l = 20) =>
  pgEnabled() ? pg.listLobbiesForPlayer(p, l) : file_listLobbiesForPlayer(p, l);
export const listRecentSettledLobbies = (l = 12) =>
  pgEnabled() ? pg.listRecentSettledLobbies(l) : file_listRecentSettledLobbies(l);

/**
 * Claim a seat without a read-modify-write.
 *
 * On Postgres this is a single conditional UPDATE, so two players joining in the
 * same instant cannot be handed the same seat — the loser's WHERE stops
 * matching. The file store has no such guarantee and does not need one: it is
 * single-process, and its callers already hold an in-process lock.
 *
 * Returns null when nothing is joinable, meaning "open a new lobby".
 */
export const claimSeat = async (
  playerId: string,
  seat: Omit<SeatRecord, 'index'>,
): Promise<{ lobby: Lobby; seatIndex: number } | null> => {
  if (pgEnabled()) return pg.claimSeat(playerId, seat);

  const lobby = await file_findJoinableLobby(Date.now());
  if (!lobby) return null;
  if (lobby.seats.some((s) => s.id === normalizeAddress(playerId))) return null;

  const free = lobby.seats.find((s) => s.kind === 'empty');
  if (!free) return null;

  Object.assign(free, seat, { index: free.index });
  await file_save();
  return { lobby, seatIndex: free.index };
};

export const recordTicket = (t: Omit<TicketRecord, 'createdAt'>) =>
  pgEnabled() ? pg.recordTicket(t) : file_recordTicket(t);
export const listTickets = (p?: string) => (pgEnabled() ? pg.listTickets(p) : file_listTickets(p));

export const __resetForTests = () =>
  pgEnabled() ? pg.__resetForTests() : file___resetForTests();
