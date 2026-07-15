import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DATA_DIR } from './paths.js';

/**
 * Minimal .env loader + typed config. Avoids a dotenv dependency so the app
 * installs with fewer moving parts. Reads dashboard/.env if present.
 */

export { ROOT, DATA_DIR };

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();

const bool = (v, def) => (v == null ? def : /^(1|true|yes|on)$/i.test(String(v).trim()));
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const isProd = process.env.NODE_ENV === 'production';

export const config = {
  port: num(process.env.PORT, 4820),
  // In a container the server must bind 0.0.0.0 so the reverse proxy can reach
  // it; locally we bind loopback so nothing else on the machine is exposed.
  host: process.env.HOST || (isProd ? '0.0.0.0' : '127.0.0.1'),
  // Public base URL of the deployed site (used for cookie Secure + absolute
  // links). e.g. https://kumora.io
  publicUrl: process.env.PUBLIC_URL || '',
  outreachToken: process.env.OUTREACH_TOKEN || '',

  resendApiKey: process.env.RESEND_API_KEY || '',
  fromEmail: process.env.FROM_EMAIL || '',
  fromName: process.env.FROM_NAME || '',
  replyTo: process.env.REPLY_TO || process.env.FROM_EMAIL || '',

  physicalAddress: process.env.PHYSICAL_ADDRESS || '',
  unsubscribeMailto: process.env.UNSUBSCRIBE_MAILTO || '',

  senderCompany: process.env.SENDER_COMPANY || '',
  offer: process.env.OFFER || '',
  ctaGoal: process.env.CTA_GOAL || 'a quick call',

  dailyCap: num(process.env.DAILY_CAP, 30),
  testMode: bool(process.env.TEST_MODE, true),
  testInbox: process.env.TEST_INBOX || process.env.FROM_EMAIL || '',

  // ── DeepSeek (email generation) ──────────────────────────────────────────
  // OpenAI-compatible chat-completions API. Replaces the Claude CLI so the
  // server needs no interactive login and runs fine on a VPS. This key is
  // ALWAYS the platform's own — users never configure their own model key.
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',

  // ── Stripe (subscriptions) ───────────────────────────────────────────────
  // Billing is optional at boot: with no keys set, the Billing page still
  // renders but upgrades explain that purchasing isn't available yet.
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePricePro: process.env.STRIPE_PRICE_PRO || '',
  stripePriceUltra: process.env.STRIPE_PRICE_ULTRA || '',

  isProd
};

/**
 * Per-user settings. Each user's overrides live in the SQLite `settings` table
 * (one JSON blob per user) and OVERRIDE the .env values above. .env is just the
 * initial seed for the owner account, so the current setup keeps working while
 * new users start from the same env defaults until they save their own.
 *
 * These are imported lazily to avoid a load-time cycle with db.js (which needs
 * config for its data dir). All functions accept a userId and default to the
 * owner so any not-yet-migrated caller still works.
 */
import { db, OWNER_USER_ID } from './db.js';

const SETTING_KEYS = [
  'resendApiKey', 'fromEmail', 'fromName', 'replyTo', 'physicalAddress',
  'unsubscribeMailto', 'senderCompany', 'offer', 'ctaGoal', 'dailyCap',
  'testMode', 'testInbox',
  // Which writer agent voices the emails (see server/writers.js).
  'writerStyle',
  // Pro/Ultra only: extra instructions injected into the AI writer's prompt.
  // Saved for everyone but ENFORCED at generation time (engine.js strips it
  // for free plans), so a downgrade instantly stops honoring it.
  'aiInstructions'
];

/** Env-seeded defaults, used when a user hasn't overridden a given field. */
function envDefaults() {
  return {
    resendApiKey: config.resendApiKey,
    fromEmail: config.fromEmail,
    fromName: config.fromName,
    replyTo: config.replyTo,
    physicalAddress: config.physicalAddress,
    unsubscribeMailto: config.unsubscribeMailto,
    senderCompany: config.senderCompany,
    offer: config.offer,
    ctaGoal: config.ctaGoal,
    dailyCap: config.dailyCap,
    testMode: config.testMode,
    testInbox: config.testInbox,
    writerStyle: 'friendly',
    aiInstructions: ''
  };
}

function readSaved(userId) {
  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(userId);
  if (!row) return {};
  try { return JSON.parse(row.data); } catch { return {}; }
}

export function loadSettings(userId = OWNER_USER_ID) {
  const saved = readSaved(userId);
  const defaults = envDefaults();
  const out = {};
  for (const k of SETTING_KEYS) out[k] = saved[k] ?? defaults[k];
  return out;
}

export function saveSettings(userId, patch) {
  if (typeof userId === 'object') { patch = userId; userId = OWNER_USER_ID; } // back-compat
  const saved = readSaved(userId);
  // Only persist known keys; keep prior saved overrides for keys not in patch.
  const next = { ...saved };
  for (const k of SETTING_KEYS) if (k in patch) next[k] = patch[k];
  db.prepare(
    `INSERT INTO settings (user_id, data) VALUES (@user_id, @data)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`
  ).run({ user_id: userId, data: JSON.stringify(next) });
  return loadSettings(userId);
}

/** Which settings are still missing before real sending can work. */
export function settingsHealth(sOrUser) {
  const s = (sOrUser == null || typeof sOrUser === 'string')
    ? loadSettings(sOrUser || OWNER_USER_ID)
    : sOrUser;
  const missing = [];
  if (!s.resendApiKey) missing.push('Resend API key');
  if (!s.fromEmail) missing.push('From email (on your verified domain)');
  if (!s.fromName) missing.push('From name');
  if (!s.physicalAddress) missing.push('Physical address (required for compliance)');
  return { ok: missing.length === 0, missing };
}
