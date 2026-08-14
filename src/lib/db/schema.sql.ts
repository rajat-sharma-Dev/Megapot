/**
 * The schema, as one idempotent statement block.
 *
 * Kept in the repo rather than in a migration tool because there is exactly one
 * version of it and it is created on demand — the first query to touch a cold
 * database runs this, and every statement is `IF NOT EXISTS`, so it is safe to
 * run on every cold start of every instance.
 *
 * Money is `TEXT`, not `NUMERIC` and certainly not a float. Every amount in this
 * app is an integer number of USDC base units held as a decimal string, and the
 * one thing that must never happen is a value round-tripping through a float on
 * its way to buying a real lottery ticket. TEXT makes that impossible by
 * construction; the arithmetic happens in `BigInt` in application code.
 *
 * Seats and settlements are `JSONB`. They are read and written whole, never
 * queried field-by-field, and modelling five seats as a child table would buy
 * nothing but joins.
 */
export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS players (
  id                        TEXT PRIMARY KEY,
  name                      TEXT NOT NULL,
  credits_units             TEXT NOT NULL DEFAULT '0',
  vault_units               TEXT NOT NULL DEFAULT '0',
  lifetime_deposited_units  TEXT NOT NULL DEFAULT '0',
  lifetime_withdrawn_units  TEXT NOT NULL DEFAULT '0',
  lifetime_wagered_units    TEXT NOT NULL DEFAULT '0',
  lifetime_won_units        TEXT NOT NULL DEFAULT '0',
  races_played              INTEGER NOT NULL DEFAULT 0,
  races_won                 INTEGER NOT NULL DEFAULT 0,
  races_retired             INTEGER NOT NULL DEFAULT 0,
  lifetime_points           INTEGER NOT NULL DEFAULT 0,
  best_race_score           INTEGER NOT NULL DEFAULT 0,
  total_stolen              INTEGER NOT NULL DEFAULT 0,
  tickets_earned            INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobbies (
  id                  TEXT PRIMARY KEY,
  seed                BIGINT NOT NULL,
  state               TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  fill_deadline       TIMESTAMPTZ NOT NULL,
  submit_deadline     TIMESTAMPTZ,
  entry_fee_units     TEXT NOT NULL,
  ticket_price_units  TEXT NOT NULL,
  drawing_id          TEXT NOT NULL,
  rollover_count      INTEGER NOT NULL DEFAULT 0,
  seats               JSONB NOT NULL,
  settlement          JSONB
);

-- Matchmaking asks one question constantly: "is there an open lobby with a free
-- seat whose fill window hasn't closed?" This is that question.
CREATE INDEX IF NOT EXISTS lobbies_open_idx
  ON lobbies (state, fill_deadline)
  WHERE state = 'open';

CREATE INDEX IF NOT EXISTS lobbies_pending_idx
  ON lobbies (state) WHERE state <> 'settled';

CREATE TABLE IF NOT EXISTS tickets (
  id          TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL,
  tx_hash     TEXT NOT NULL,
  drawing_id  TEXT NOT NULL,
  count       INTEGER NOT NULL,
  lobby_id    TEXT,
  network     TEXT NOT NULL,
  simulated   BOOLEAN NOT NULL DEFAULT false,
  ticket_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tickets_player_idx ON tickets (player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger (
  id           BIGSERIAL PRIMARY KEY,
  player_id    TEXT NOT NULL,
  kind         TEXT NOT NULL,
  delta_units  TEXT NOT NULL,
  tx_hash      TEXT,
  lobby_id     TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_player_idx ON ledger (player_id, id DESC);

-- Deposit idempotency. A UNIQUE index rather than a check-then-insert: two
-- concurrent requests crediting the same transaction hash is exactly the race
-- that mints money out of nothing, and only the database can settle it.
CREATE UNIQUE INDEX IF NOT EXISTS ledger_tx_unique
  ON ledger (lower(tx_hash)) WHERE tx_hash IS NOT NULL;

-- Singleton rows: the house float and the orb rollover counter.
CREATE TABLE IF NOT EXISTS app_state (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`;
