-- The dashboard's storage. Three tables and no projections, deliberately.
--
-- An earlier design maintained clip/clip_target projection tables in SQL so the
-- dashboard could render current state without scanning the log. That work is
-- already done on the box: mirror-ledger.json IS the projection, computed by the
-- thing that knows the truth. Shipping it as a snapshot removes a whole class of
-- drift — a projection that disagrees with the ledger — for less code.

-- Append-only. INSERT OR IGNORE on the ULID makes a retried batch free, and the
-- unique dedupe_key stops the same decision being recorded twice from two runs.
CREATE TABLE IF NOT EXISTS event (
  id          TEXT PRIMARY KEY,
  dedupe_key  TEXT UNIQUE,
  ts          TEXT NOT NULL,
  run_id      TEXT,
  source      TEXT,
  kind        TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',
  clip_id     TEXT,
  platform    TEXT,
  account_id  TEXT,
  post_key    TEXT,
  url         TEXT,
  message     TEXT,
  data        TEXT,
  received_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS event_ts   ON event (ts DESC);
CREATE INDEX IF NOT EXISTS event_kind ON event (kind, ts DESC);

-- Current state, shipped whole rather than rebuilt from the log: one row per
-- kind, last writer wins.
CREATE TABLE IF NOT EXISTS snapshot (
  name       TEXT PRIMARY KEY,
  body       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- The heartbeat. The uploader sends an empty batch when idle, because without
-- one "nothing happened" and "the box is off" look identical on a dashboard.
CREATE TABLE IF NOT EXISTS ingest_batch (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      TEXT NOT NULL,
  count   INTEGER NOT NULL,
  source  TEXT
);
CREATE INDEX IF NOT EXISTS ingest_at ON ingest_batch (at DESC);
