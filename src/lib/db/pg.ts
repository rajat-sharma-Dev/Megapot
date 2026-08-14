/**
 * Postgres persistence — the backend used anywhere `DATABASE_URL` is set.
 *
 * Implements the same surface as the file store, so nothing above this layer
 * knows which one it is talking to. The file store stays the default for a
 * clean checkout (zero credentials, zero setup); this one takes over on any real
 * deployment, where a JSON file on disk is not merely suboptimal but wrong:
 * Vercel's filesystem is read-only, and even in /tmp each instance would keep
 * its own copy, so a balance credited on one request would vanish on the next.
 *
 * Two things here are more than a port:
 *
 *  · **Seat assignment is atomic.** The file store serialises joins with an
 *    in-process promise chain, which is meaningless across instances — two
 *    players can be handed the same seat. Claiming a seat is now a single
 *    conditional UPDATE that re-checks the seat is still empty, so Postgres
 *    settles the race for us.
 *  · **Deposit idempotency is enforced by the database.** A unique index on the
 *    transaction hash means two concurrent requests crediting the same deposit
 *    cannot both win, which a check-then-insert in application code cannot
 *    guarantee.
 *
 * Amounts are TEXT columns holding integer base units, cast to `numeric` only
 * inside SQL arithmetic. No value ever passes through a float.
 */

import 'server-only';
import { neon } from '@neondatabase/serverless';
import { SCHEMA } from './schema.sql';
import type {
  Player, Lobby, SeatRecord, TicketRecord, LedgerEntry, LedgerKind,
} from './store';

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  '';

export const hasPostgres = () => !!connectionString;

const sql = connectionString ? neon(connectionString) : null;

function db() {
  if (!sql) throw new Error('DATABASE_URL is not set — the Postgres store is unavailable.');
  return sql;
}

/**
 * Retry a query through transient connection failures.
 *
 * The driver talks to Neon over HTTP, so a cold pooler or a blip surfaces as
 * `TypeError: fetch failed` rather than a SQL error. Those are worth one or two
 * quick retries; a genuine SQL error (bad column, constraint violation) is not,
 * and retrying it would just be slower before failing the same way.
 */
async function retry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const m = String((err as Error).message ?? '').toLowerCase();
      const transient =
        m.includes('fetch failed') ||
        m.includes('error connecting') ||
        m.includes('econnreset') ||
        m.includes('timeout');
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 120 * 2 ** i));
    }
  }
  throw last;
}

/**
 * Create the schema once per instance.
 *
 * Every statement is `IF NOT EXISTS`, so racing instances are harmless. The
 * promise is cached so concurrent callers share one round trip rather than each
 * issuing the whole block.
 */
const g = globalThis as unknown as { __rallyPgReady?: Promise<void> };
function ready(): Promise<void> {
  g.__rallyPgReady ??= (async () => {
    /**
     * One statement per round trip.
     *
     * Neon's HTTP driver maps each call to a single prepared statement, so a
     * multi-statement block fails with "cannot insert multiple commands into a
     * prepared statement". Comments are stripped first because a `;` inside one
     * would otherwise split a statement in half.
     */
    const statements = SCHEMA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*\n/g, '\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await retry(() => db().query(statement));
    }
  })().catch((e) => {
    // Let the next request retry rather than caching a failure forever.
    g.__rallyPgReady = undefined;
    throw e;
  });
  return g.__rallyPgReady;
}

const now = () => new Date().toISOString();
export const normalizeAddress = (a: string) => a.trim().toLowerCase();

const int = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

// ─── Row mapping ────────────────────────────────────────────────────────────

function toPlayer(r: Row): Player {
  return {
    id: r.id,
    name: r.name,
    creditsUnits: String(r.credits_units ?? '0'),
    vaultUnits: String(r.vault_units ?? '0'),
    lifetimeDepositedUnits: String(r.lifetime_deposited_units ?? '0'),
    lifetimeWithdrawnUnits: String(r.lifetime_withdrawn_units ?? '0'),
    lifetimeWageredUnits: String(r.lifetime_wagered_units ?? '0'),
    lifetimeWonUnits: String(r.lifetime_won_units ?? '0'),
    racesPlayed: int(r.races_played),
    racesWon: int(r.races_won),
    racesRetired: int(r.races_retired),
    lifetimePoints: int(r.lifetime_points),
    bestRaceScore: int(r.best_race_score),
    totalStolen: int(r.total_stolen),
    ticketsEarned: int(r.tickets_earned),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function toLobby(r: Row): Lobby {
  return {
    id: r.id,
    seed: Number(r.seed),
    state: r.state,
    createdAt: new Date(r.created_at).toISOString(),
    fillDeadline: new Date(r.fill_deadline).toISOString(),
    submitDeadline: r.submit_deadline ? new Date(r.submit_deadline).toISOString() : null,
    entryFeeUnits: String(r.entry_fee_units),
    ticketPriceUnits: String(r.ticket_price_units),
    drawingId: String(r.drawing_id),
    rolloverCount: int(r.rollover_count),
    seats: r.seats as SeatRecord[],
    settlement: r.settlement ?? null,
  };
}

function toTicket(r: Row): TicketRecord {
  return {
    id: r.id,
    playerId: r.player_id,
    txHash: r.tx_hash,
    drawingId: String(r.drawing_id),
    count: int(r.count),
    lobbyId: r.lobby_id ?? null,
    network: r.network,
    simulated: !!r.simulated,
    ticketIds: Array.isArray(r.ticket_ids) ? r.ticket_ids.map(String) : [],
    createdAt: new Date(r.created_at).toISOString(),
  };
}

function toLedger(r: Row): LedgerEntry {
  return {
    id: String(r.id),
    playerId: r.player_id,
    kind: r.kind,
    deltaUnits: String(r.delta_units),
    txHash: r.tx_hash ?? null,
    lobbyId: r.lobby_id ?? null,
    note: r.note ?? null,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

// ─── Players ────────────────────────────────────────────────────────────────

export async function getOrCreatePlayer(address: string, name?: string): Promise<Player> {
  await ready();
  const id = normalizeAddress(address);
  const fallback = name || `Racer ${id.slice(2, 6).toUpperCase()}`;

  const rows = (await db()`
    INSERT INTO players (id, name) VALUES (${id}, ${fallback})
    ON CONFLICT (id) DO UPDATE
      SET name = CASE WHEN ${name ?? null}::text IS NOT NULL THEN ${name ?? null}::text ELSE players.name END,
          updated_at = now()
    RETURNING *
  `) as Row[];

  return toPlayer(rows[0]);
}

export async function getPlayer(address: string): Promise<Player | null> {
  await ready();
  const rows = (await db()`SELECT * FROM players WHERE id = ${normalizeAddress(address)}`) as Row[];
  return rows[0] ? toPlayer(rows[0]) : null;
}

/** Column names for the subset of Player fields callers actually patch. */
const PATCHABLE: Record<string, string> = {
  name: 'name',
  creditsUnits: 'credits_units',
  vaultUnits: 'vault_units',
  lifetimeDepositedUnits: 'lifetime_deposited_units',
  lifetimeWithdrawnUnits: 'lifetime_withdrawn_units',
  lifetimeWageredUnits: 'lifetime_wagered_units',
  lifetimeWonUnits: 'lifetime_won_units',
  racesPlayed: 'races_played',
  racesWon: 'races_won',
  racesRetired: 'races_retired',
  lifetimePoints: 'lifetime_points',
  bestRaceScore: 'best_race_score',
  totalStolen: 'total_stolen',
  ticketsEarned: 'tickets_earned',
};

export async function updatePlayer(id: string, patch: Partial<Player>): Promise<Player> {
  await ready();
  const key = normalizeAddress(id);

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [field, column] of Object.entries(PATCHABLE)) {
    const v = (patch as Record<string, unknown>)[field];
    if (v === undefined) continue;
    values.push(v);
    sets.push(`${column} = $${values.length}`);
  }
  if (!sets.length) {
    const existing = await getPlayer(key);
    if (!existing) throw new Error(`Unknown player ${key}`);
    return existing;
  }

  values.push(key);
  const rows = (await db().query(
    `UPDATE players SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING *`,
    values,
  )) as Row[];

  if (!rows[0]) throw new Error(`Unknown player ${key}`);
  return toPlayer(rows[0]);
}

export async function listPlayers(): Promise<Player[]> {
  await ready();
  return ((await db()`SELECT * FROM players`) as Row[]).map(toPlayer);
}

/**
 * Move money and write the ledger row in ONE statement.
 *
 * The balance guard lives in the `WHERE`, so an overdraw simply matches no rows
 * and the ledger insert selects from an empty CTE — there is no window in which
 * the balance is updated but the ledger is not, and no way to read-then-write a
 * stale balance. A duplicate deposit hash is rejected by the unique index rather
 * than by a prior existence check that another request could race.
 */
export async function adjustBalance(opts: {
  playerId: string;
  field: 'creditsUnits' | 'vaultUnits';
  deltaUnits: bigint;
  kind: LedgerKind;
  txHash?: string | null;
  lobbyId?: string | null;
  note?: string | null;
}): Promise<Player> {
  await ready();
  const key = normalizeAddress(opts.playerId);
  const column = opts.field === 'vaultUnits' ? 'vault_units' : 'credits_units';
  const delta = opts.deltaUnits.toString();

  const rows = (await db().query(
    `
    WITH moved AS (
      UPDATE players
         SET ${column} = (${column}::numeric + $2::numeric)::text,
             updated_at = now()
       WHERE id = $1
         AND (${column}::numeric + $2::numeric) >= 0
      RETURNING *
    ), logged AS (
      INSERT INTO ledger (player_id, kind, delta_units, tx_hash, lobby_id, note)
      SELECT $1, $3, $2, $4, $5, $6 FROM moved
      RETURNING 1
    )
    SELECT * FROM moved
    `,
    [key, delta, opts.kind, opts.txHash ?? null, opts.lobbyId ?? null, opts.note ?? null],
  )) as Row[];

  if (!rows[0]) {
    throw new Error(
      `Insufficient ${opts.field === 'creditsUnits' ? 'balance' : 'vault'}: ` +
        `need ${-opts.deltaUnits} base units`,
    );
  }
  return toPlayer(rows[0]);
}

export async function listLedger(playerId?: string, limit = 50): Promise<LedgerEntry[]> {
  await ready();
  const rows = playerId
    ? ((await db()`
        SELECT * FROM ledger WHERE player_id = ${normalizeAddress(playerId)}
        ORDER BY id DESC LIMIT ${limit}
      `) as Row[])
    : ((await db()`SELECT * FROM ledger ORDER BY id DESC LIMIT ${limit}`) as Row[]);
  return rows.map(toLedger);
}

export async function ledgerHasTx(txHash: string): Promise<boolean> {
  await ready();
  const rows = (await db()`
    SELECT 1 FROM ledger WHERE lower(tx_hash) = ${txHash.toLowerCase()} LIMIT 1
  `) as Row[];
  return rows.length > 0;
}

// ─── App state (house float, orb rollover) ──────────────────────────────────

const HOUSE_FLOAT_SEED = process.env.RALLY_HOUSE_FLOAT ?? '2000000';

async function getState(key: string, seed: string): Promise<string> {
  await ready();
  const rows = (await db()`
    INSERT INTO app_state (key, value) VALUES (${key}, ${seed})
    ON CONFLICT (key) DO UPDATE SET value = app_state.value
    RETURNING value
  `) as Row[];
  return String(rows[0].value);
}

export async function getHouseFloat(): Promise<bigint> {
  return BigInt(await getState('house_float', HOUSE_FLOAT_SEED));
}

export async function adjustHouseFloat(deltaUnits: bigint): Promise<bigint> {
  await ready();
  await getState('house_float', HOUSE_FLOAT_SEED);

  const rows = (await db().query(
    `UPDATE app_state SET value = (value::numeric + $1::numeric)::text
      WHERE key = 'house_float' AND (value::numeric + $1::numeric) >= 0
     RETURNING value`,
    [deltaUnits.toString()],
  )) as Row[];

  if (!rows[0]) throw new Error('House float cannot cover this stake');
  return BigInt(rows[0].value);
}

export async function getOrbRollover(): Promise<number> {
  return int(await getState('orb_rollover', '0'));
}

export async function bumpOrbRollover(claimed: boolean): Promise<number> {
  await ready();
  await getState('orb_rollover', '0');
  const rows = (await db()`
    UPDATE app_state
       SET value = CASE WHEN ${claimed} THEN '0' ELSE (value::numeric + 1)::text END
     WHERE key = 'orb_rollover'
    RETURNING value
  `) as Row[];
  return int(rows[0]?.value);
}

// ─── Lobbies ────────────────────────────────────────────────────────────────

export async function createLobby(lobby: Lobby): Promise<Lobby> {
  await ready();
  await db()`
    INSERT INTO lobbies (
      id, seed, state, created_at, fill_deadline, submit_deadline,
      entry_fee_units, ticket_price_units, drawing_id, rollover_count, seats, settlement
    ) VALUES (
      ${lobby.id}, ${lobby.seed}, ${lobby.state}, ${lobby.createdAt}, ${lobby.fillDeadline},
      ${lobby.submitDeadline}, ${lobby.entryFeeUnits}, ${lobby.ticketPriceUnits},
      ${lobby.drawingId}, ${lobby.rolloverCount},
      ${JSON.stringify(lobby.seats)}::jsonb, ${lobby.settlement ? JSON.stringify(lobby.settlement) : null}::jsonb
    )
    ON CONFLICT (id) DO NOTHING
  `;
  return lobby;
}

export async function getLobby(id: string): Promise<Lobby | null> {
  await ready();
  const rows = (await db()`SELECT * FROM lobbies WHERE id = ${id}`) as Row[];
  return rows[0] ? toLobby(rows[0]) : null;
}

/** Write a lobby back. Replaces the file store's whole-file `save()`. */
export async function saveLobby(lobby: Lobby): Promise<void> {
  await ready();
  await db()`
    UPDATE lobbies SET
      state = ${lobby.state},
      fill_deadline = ${lobby.fillDeadline},
      submit_deadline = ${lobby.submitDeadline},
      rollover_count = ${lobby.rolloverCount},
      seats = ${JSON.stringify(lobby.seats)}::jsonb,
      settlement = ${lobby.settlement ? JSON.stringify(lobby.settlement) : null}::jsonb
    WHERE id = ${lobby.id}
  `;
}

/**
 * Claim a seat in an open lobby, atomically.
 *
 * One statement. It picks the oldest open lobby that still has an empty seat and
 * does not already contain this player, then updates that seat only if it is
 * *still* empty at write time. Two requests arriving together cannot both
 * succeed: Postgres serialises the row update, and the loser's `WHERE` no longer
 * matches, so it gets no row back and retries against the next lobby.
 *
 * Returns null when there is nothing joinable, which the caller treats as "open
 * a new lobby".
 */
export async function claimSeat(
  playerId: string,
  seat: Omit<SeatRecord, 'index'>,
): Promise<{ lobby: Lobby; seatIndex: number } | null> {
  await ready();
  const id = normalizeAddress(playerId);

  const rows = (await db().query(
    `
    WITH candidate AS (
      SELECT l.id,
             (SELECT MIN(ord) - 1
                FROM jsonb_array_elements(l.seats) WITH ORDINALITY t(seat, ord)
               WHERE seat->>'kind' = 'empty')::int AS seat_index
        FROM lobbies l
       WHERE l.state = 'open'
         AND l.fill_deadline > now()
         AND l.seats @> '[{"kind":"empty"}]'::jsonb
         AND NOT (l.seats @> jsonb_build_array(jsonb_build_object('id', $2::text)))
       ORDER BY l.created_at
       LIMIT 1
    )
    UPDATE lobbies l
       SET seats = jsonb_set(
             l.seats,
             ARRAY[c.seat_index::text],
             $1::jsonb || jsonb_build_object('index', c.seat_index)
           )
      FROM candidate c
     WHERE l.id = c.id
       AND l.seats->(c.seat_index)->>'kind' = 'empty'
    RETURNING l.*, c.seat_index
    `,
    [JSON.stringify(seat), id],
  )) as Row[];

  if (!rows[0]) return null;
  return { lobby: toLobby(rows[0]), seatIndex: int(rows[0].seat_index) };
}

export async function findJoinableLobby(nowMs: number): Promise<Lobby | null> {
  await ready();
  const rows = (await db()`
    SELECT * FROM lobbies
     WHERE state = 'open'
       AND fill_deadline > ${new Date(nowMs).toISOString()}
       AND seats @> '[{"kind":"empty"}]'::jsonb
     ORDER BY created_at
     LIMIT 1
  `) as Row[];
  return rows[0] ? toLobby(rows[0]) : null;
}

export async function listPendingLobbies(): Promise<Lobby[]> {
  await ready();
  const rows = (await db()`
    SELECT * FROM lobbies WHERE state <> 'settled' ORDER BY created_at LIMIT 50
  `) as Row[];
  return rows.map(toLobby);
}

export async function listLobbiesForPlayer(playerId: string, limit = 20): Promise<Lobby[]> {
  await ready();
  const rows = (await db()`
    SELECT * FROM lobbies
     WHERE seats @> jsonb_build_array(jsonb_build_object('id', ${normalizeAddress(playerId)}::text))
     ORDER BY created_at DESC
     LIMIT ${limit}
  `) as Row[];
  return rows.map(toLobby);
}

export async function listRecentSettledLobbies(limit = 12): Promise<Lobby[]> {
  await ready();
  const rows = (await db()`
    SELECT * FROM lobbies
     WHERE state = 'settled'
     ORDER BY (settlement->>'settledAt') DESC NULLS LAST
     LIMIT ${limit}
  `) as Row[];
  return rows.map(toLobby);
}

// ─── Tickets ────────────────────────────────────────────────────────────────

export async function recordTicket(t: Omit<TicketRecord, 'createdAt'>): Promise<TicketRecord> {
  await ready();
  const rows = (await db()`
    INSERT INTO tickets (id, player_id, tx_hash, drawing_id, count, lobby_id, network, simulated, ticket_ids)
    VALUES (
      ${t.id}, ${normalizeAddress(t.playerId)}, ${t.txHash}, ${t.drawingId}, ${t.count},
      ${t.lobbyId}, ${t.network}, ${!!t.simulated}, ${JSON.stringify(t.ticketIds ?? [])}::jsonb
    )
    ON CONFLICT (id) DO UPDATE SET count = EXCLUDED.count
    RETURNING *
  `) as Row[];
  return toTicket(rows[0]);
}

export async function listTickets(playerId?: string): Promise<TicketRecord[]> {
  await ready();
  const rows = playerId
    ? ((await db()`
        SELECT * FROM tickets WHERE player_id = ${normalizeAddress(playerId)}
        ORDER BY created_at DESC
      `) as Row[])
    : ((await db()`SELECT * FROM tickets ORDER BY created_at DESC LIMIT 200`) as Row[]);
  return rows.map(toTicket);
}

// ─── Test support ───────────────────────────────────────────────────────────

export async function __resetForTests(): Promise<void> {
  await ready();
  await db()`TRUNCATE players, lobbies, tickets, ledger, app_state`;
}

export { now };
