import crypto from 'node:crypto';
import { db, OWNER_USER_ID, generateApiKey } from './db.js';

/**
 * Authentication primitives — no external deps (keeps with this project's
 * few-moving-parts philosophy). Uses Node's built-in crypto:
 *   - passwords: scrypt with a per-user random salt, constant-time compare.
 *   - website sessions: opaque random id stored in an httpOnly cookie, backed
 *     by the sessions table (server-side, so logout truly invalidates).
 *   - extension: a per-user API key sent as `Authorization: Bearer <key>`.
 *
 * Both the cookie session and the API key resolve to the same user_id, so the
 * website and the extension act as one account.
 */

const SESSION_COOKIE = 'lex_session';
const SESSION_TTL_DAYS = 30;

// ── password hashing ────────────────────────────────────────────────────────

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  let derived;
  try {
    derived = crypto.scryptSync(String(password), salt, expected.length);
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// ── users ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** Create a user. Throws {code} on validation / duplicate errors. */
export function createUser(email, password) {
  const addr = normalizeEmail(email);
  if (!EMAIL_RE.test(addr)) throw Object.assign(new Error('invalid email'), { code: 'bad_email' });
  if (String(password || '').length < 8) {
    throw Object.assign(new Error('password must be at least 8 characters'), { code: 'weak_password' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(addr);
  if (existing) throw Object.assign(new Error('email already registered'), { code: 'email_taken' });

  const id = 'u_' + crypto.randomBytes(9).toString('base64url');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, email, password_hash, plan, plan_status, api_key, created_at, updated_at)
     VALUES (@id, @email, @hash, 'free', 'active', @apiKey, @now, @now)`
  ).run({ id, email: addr, hash: hashPassword(password), apiKey: generateApiKey(), now });
  db.prepare(`INSERT INTO settings (user_id, data) VALUES (?, '{}')`).run(id);
  return getUserById(id);
}

export function getUserById(id) {
  return db.prepare('SELECT id, email, plan, plan_status, api_key, created_at FROM users WHERE id = ?').get(id) || null;
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) || null;
}

/** Verify email+password. Returns the user row or null. */
export function authenticate(email, password) {
  const user = getUserByEmail(email);
  if (!user || !user.password_hash) return null;
  return verifyPassword(password, user.password_hash) ? getUserById(user.id) : null;
}

// ── sessions ────────────────────────────────────────────────────────────────

export function createSession(userId) {
  const id = crypto.randomBytes(24).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_DAYS * 86400_000);
  db.prepare(
    `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(id, userId, now.toISOString(), expires.toISOString());
  return { id, expires };
}

export function resolveSession(sessionId) {
  if (!sessionId) return null;
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return row.user_id;
}

export function destroySession(sessionId) {
  if (sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// ── API keys (extension) ────────────────────────────────────────────────────

export function resolveApiKey(apiKey) {
  if (!apiKey) return null;
  const row = db.prepare('SELECT id FROM users WHERE api_key = ?').get(String(apiKey));
  return row ? row.id : null;
}

export function getApiKey(userId) {
  const row = db.prepare('SELECT api_key FROM users WHERE id = ?').get(userId);
  return row ? row.api_key : null;
}

export function regenerateApiKey(userId) {
  const key = generateApiKey();
  db.prepare('UPDATE users SET api_key = ?, updated_at = ? WHERE id = ?')
    .run(key, new Date().toISOString(), userId);
  return key;
}

// ── cookie helpers (no cookie-parser dependency) ────────────────────────────

export function readSessionCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === SESSION_COOKIE) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

export function setSessionCookie(res, sessionId, expires, { secure } = {}) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`
  ];
  if (secure) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
}

/**
 * Resolve the acting user for a request:
 *   1) Authorization: Bearer <api_key>  → the extension
 *   2) session cookie                   → the website
 * Returns userId or null.
 */
export function resolveRequestUser(req) {
  const authz = req.get?.('Authorization') || req.headers?.authorization;
  if (authz && /^Bearer\s+/i.test(authz)) {
    const key = authz.replace(/^Bearer\s+/i, '').trim();
    const uid = resolveApiKey(key);
    if (uid) return uid;
  }
  return resolveSession(readSessionCookie(req));
}

export { OWNER_USER_ID };
