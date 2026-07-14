import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared filesystem paths. Lives in its own module so both config.js and db.js
 * can import it without creating a circular dependency (config needs the DB for
 * per-user settings; the DB needs the data dir).
 *
 * DATA_DIR is where the SQLite database and any local state live. It defaults
 * to <project>/data for local dev, but is overridable via the DATA_DIR env var
 * so a deployed container can point it at a MOUNTED VOLUME (otherwise every
 * redeploy would start with an empty database and lose all users).
 *
 * SQLITE_PATH optionally overrides the full DB file path directly, for setups
 * that mount a single file rather than a directory.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT, 'data');

export const SQLITE_PATH = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.join(DATA_DIR, 'app.db');
