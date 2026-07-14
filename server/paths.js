import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared filesystem paths. Lives in its own module so both config.js and db.js
 * can import it without creating a circular dependency (config needs the DB for
 * per-user settings; the DB needs the data dir).
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const DATA_DIR = path.join(ROOT, 'data');
