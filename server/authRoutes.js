import express from 'express';
import { config } from './config.js';
import {
  createUser, authenticate, getUserById,
  createSession, destroySession,
  setSessionCookie, clearSessionCookie, readSessionCookie,
  getApiKey, regenerateApiKey, resolveSession
} from './auth.js';

/**
 * Auth + account endpoints (website) and the extension "connect" handshake.
 *
 * Mounted at /api/auth and /api/account. Kept separate from the data routes so
 * the tenant-scoping middleware there stays focused on already-authenticated
 * requests.
 */
export const authRouter = express.Router();

function publicUser(u) {
  return u ? { id: u.id, email: u.email, plan: u.plan, planStatus: u.plan_status } : null;
}

// Resolve the logged-in website user from the session cookie (or null).
function currentUserId(req) {
  return resolveSession(readSessionCookie(req));
}

function startSession(res, userId) {
  const { id, expires } = createSession(userId);
  setSessionCookie(res, id, expires, { secure: config.isProd });
}

// ── register ────────────────────────────────────────────────────────────────
authRouter.post('/auth/register', (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = createUser(email, password);
    startSession(res, user.id);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    const status = err.code === 'email_taken' ? 409 : 400;
    res.status(status).json({ error: err.message, code: err.code || 'register_failed' });
  }
});

// ── login ─────────────────────────────────────────────────────────────────—
authRouter.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = authenticate(email, password);
  if (!user) return res.status(401).json({ error: 'invalid email or password', code: 'bad_credentials' });
  startSession(res, user.id);
  res.json({ ok: true, user: publicUser(user) });
});

// ── logout ─────────────────���──────────────────────────────────────────────—
authRouter.post('/auth/logout', (req, res) => {
  destroySession(readSessionCookie(req));
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── who am I ─────────────────────────────────────────────────────────────——
authRouter.get('/auth/me', (req, res) => {
  const uid = currentUserId(req);
  if (!uid) return res.json({ user: null });
  res.json({ user: publicUser(getUserById(uid)) });
});

// ── account: extension API key ──────────────────────────────────────────────
authRouter.get('/account/apikey', (req, res) => {
  const uid = currentUserId(req);
  if (!uid) return res.status(401).json({ error: 'not logged in' });
  res.json({ apiKey: getApiKey(uid) });
});

authRouter.post('/account/apikey/regenerate', (req, res) => {
  const uid = currentUserId(req);
  if (!uid) return res.status(401).json({ error: 'not logged in' });
  res.json({ apiKey: regenerateApiKey(uid) });
});

// ── extension connect handshake ─────────────────────────────────────────────
// The extension opens /connect (served as the SPA) via
// chrome.identity.launchWebAuthFlow. After the user logs in and clicks
// Authorize, the SPA calls this endpoint; we return the redirect URL carrying
// the API key back to the extension's chrome-extension:// callback, which Chrome
// captures automatically. The key rides in the fragment (#), never sent to a
// server or logged.
authRouter.post('/connect/authorize', (req, res) => {
  const uid = currentUserId(req);
  if (!uid) return res.status(401).json({ error: 'not logged in', code: 'need_login' });
  const redirectUri = String(req.body?.redirectUri || '');
  const state = String(req.body?.state || '');
  // Only allow handing the key back to a Chrome extension callback URL.
  if (!/^https:\/\/[a-p]{32}\.chromiumapp\.org\//.test(redirectUri)) {
    return res.status(400).json({ error: 'invalid redirect_uri', code: 'bad_redirect' });
  }
  const apiKey = getApiKey(uid);
  const url = `${redirectUri}#api_key=${encodeURIComponent(apiKey)}&state=${encodeURIComponent(state)}`;
  res.json({ ok: true, redirect: url });
});
