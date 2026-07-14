import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, SQLITE_PATH } from './paths.js';

/**
 * SQLite data layer (multi-tenant). Replaces the old single JSON file.
 *
 * Design notes:
 *  - One local file (data/app.db). No DB server to run/secure on the VPS.
 *  - WAL mode for concurrent reads while a write is in flight.
 *  - Every tenant-owned row carries user_id; all reads/writes are scoped to it,
 *    so one account can never see or touch another's leads/settings/sends.
 *  - Leads keep a hybrid shape: a few indexed columns we query on (status,
 *    email, dedupe_key) plus a JSON `data` blob holding the full lead object
 *    (draft, cost, attempts, timestamps…). This preserves the ergonomics the
 *    engine relies on (it Object.assign's arbitrary fields onto leads) without
 *    a schema migration every time a field is added.
 *
 * Phase 2 introduces a single bootstrap "owner" user that holds all existing
 * data, so the app behaves exactly as before. Phase 3 replaces that owner with
 * real registered accounts — the schema is already multi-tenant, so no further
 * data reshaping is needed then.
 */

const DB_FILE = SQLITE_PATH;

// Ensure the DB's directory exists (it may be a mounted volume path distinct
// from DATA_DIR when SQLITE_PATH is set explicitly).
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT UNIQUE,
    password_hash TEXT,
    plan          TEXT NOT NULL DEFAULT 'free',
    plan_status   TEXT NOT NULL DEFAULT 'active',
    api_key       TEXT UNIQUE,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data    TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query      TEXT,
    count      INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_campaigns_user ON campaigns(user_id);

  CREATE TABLE IF NOT EXISTS leads (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    dedupe_key TEXT NOT NULL,
    email      TEXT,
    status     TEXT NOT NULL DEFAULT 'ready',
    data       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_user_dedupe ON leads(user_id, dedupe_key);

  CREATE TABLE IF NOT EXISTS suppression (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email   TEXT NOT NULL,
    PRIMARY KEY (user_id, email)
  );

  CREATE TABLE IF NOT EXISTS sends (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ts          TEXT NOT NULL,
    event       TEXT NOT NULL,
    email       TEXT,
    to_addr     TEXT,
    lead_id     TEXT,
    campaign_id TEXT,
    idkey       TEXT,
    resend_id   TEXT,
    test_mode   INTEGER,
    error       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sends_user ON sends(user_id);
  CREATE INDEX IF NOT EXISTS idx_sends_user_email ON sends(user_id, email);

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// ── owner bootstrap ─────────────────────────────────────────────────────────
// Phase 2 runs single-tenant: one implicit owner account holds all data. Its id
// is fixed so migrations and the current (auth-less) request path can resolve it
// deterministically. Phase 3 adds real users alongside it.
export const OWNER_USER_ID = 'owner';

/** Generate a fresh extension API key. `lex_live_` prefix aids support/debugging. */
export function generateApiKey() {
  return 'lex_live_' + crypto.randomBytes(24).toString('base64url');
}

export function ensureOwner() {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, plan, plan_status, api_key, created_at, updated_at)
     VALUES (@id, NULL, 'owner', 'active', @apiKey, @now, @now)
     ON CONFLICT(id) DO NOTHING`
  ).run({ id: OWNER_USER_ID, apiKey: generateApiKey(), now });
  db.prepare(
    `INSERT INTO settings (user_id, data) VALUES (@id, '{}') ON CONFLICT(user_id) DO NOTHING`
  ).run({ id: OWNER_USER_ID });
  return OWNER_USER_ID;
}

ensureOwner();

// ── shared id helpers (moved here from the old store.js) ────────────────────
export function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

/** Stable short hash of a lead's place URL — used in idempotency keys/routes. */
export function hashKey(key) {
  return crypto.createHash('sha1').update(String(key || '')).digest('hex').slice(0, 12);
}
