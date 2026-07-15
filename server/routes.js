import express from 'express';
import { getState, update, newId, hashKey } from './store.js';
import { loadSettings, saveSettings, settingsHealth } from './config.js';
import { resolveRequestUser } from './auth.js';
import { leadsRemaining, bumpUsage, usageSummary } from './plans.js';
import { enqueueHunts } from './emailHunt.js';
import * as engine from './engine.js';
import { sendTestEmail } from './mailer.js';
import * as journal from './journal.js';

export const router = express.Router();

// ── tenant resolution ───────────────────────────────────────────────────────
// Every data route runs as a specific authenticated user, resolved from EITHER
// a website session cookie OR an `Authorization: Bearer <api_key>` (the
// extension). Both map to the same user_id, so the site and the extension act
// as one account. Unauthenticated requests are rejected here — this replaces
// the old shared OUTREACH_TOKEN entirely.
function requireUser(req, res, next) {
  const userId = resolveRequestUser(req);
  if (!userId) return res.status(401).json({ error: 'not authenticated', code: 'need_auth' });
  req.userId = userId;
  next();
}
router.use(requireUser);

// Every route below already requires an authenticated user via requireUser, so
// mutating routes need no extra gate. Kept as a named pass-through so the route
// definitions stay self-documenting about which ones mutate.
const requireToken = (req, res, next) => next();

const LEAD_FIELDS = ['name', 'website', 'email', 'phone', 'category', 'address', 'rating', 'reviews', 'mapsUrl', 'key'];

function sanitizeLead(raw) {
  const out = {};
  for (const f of LEAD_FIELDS) out[f] = raw[f] != null ? String(raw[f]) : '';
  return out;
}

// ── import from the extension (or JSON file) ───────────────────────────────
router.post('/import', requireToken, (req, res) => {
  const userId = req.userId;
  const body = req.body || {};
  const incoming = Array.isArray(body.leads) ? body.leads : [];
  const query = String(body.query || '').trim();
  if (incoming.length === 0) return res.status(400).json({ error: 'no leads in payload' });

  // Plan quota: extractions per calendar month. Dupes never count against it —
  // only genuinely new leads do — so we import new leads until the quota runs
  // out and report how many were left behind.
  const remaining = leadsRemaining(userId);
  if (remaining <= 0) {
    return res.status(402).json({
      error: 'monthly lead extraction limit reached — upgrade your plan to keep going',
      code: 'quota_leads',
      quota: usageSummary(userId)
    });
  }

  let imported = 0;
  let dupes = 0;
  let clipped = 0;
  const campaignId = newId();
  const huntIds = []; // new leads with a website but no email → server-side hunt

  update(userId, (db) => {
    for (const raw of incoming) {
      const lead = sanitizeLead(raw);
      const dedupeKey = lead.key || lead.mapsUrl || `${lead.name}|${lead.address}`;
      const existing = db.leads.find(
        (l) => (l.key || l.mapsUrl || `${l.name}|${l.address}`) === dedupeKey
      );
      if (existing) {
        // Merge in any newly-found fields (e.g. an email found on a later scrape).
        for (const f of LEAD_FIELDS) if (!existing[f] && lead[f]) existing[f] = lead[f];
        dupes++;
        continue;
      }
      if (imported >= remaining) { clipped++; continue; }
      const id = newId();
      db.leads.push({
        id,
        ...lead,
        campaignId,
        status: lead.email ? 'ready' : 'no_email',
        draft: null,
        error: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (!lead.email && lead.website) huntIds.push(id);
      imported++;
    }
    if (imported > 0) {
      db.campaigns.push({
        id: campaignId,
        query: query || '(unnamed)',
        count: imported,
        createdAt: new Date().toISOString()
      });
    }
  });

  if (imported > 0) bumpUsage(userId, { leads: imported });
  // Emails are discovered server-side now (the extension no longer visits
  // business websites) — kick off the hunt for everything that needs one.
  if (huntIds.length > 0) enqueueHunts(userId, huntIds);

  res.json({
    ok: true,
    imported,
    dupes,
    clipped, // leads NOT imported because the monthly quota ran out mid-batch
    total: getState(userId).leads.length,
    quota: usageSummary(userId)
  });
});

// ── read state ─────────────────────────────────────────────────────────────
router.get('/state', (req, res) => {
  const userId = req.userId;
  const state = getState(userId);
  const health = settingsHealth(userId);
  res.json({
    leads: state.leads,
    campaigns: state.campaigns,
    suppression: state.suppression,
    engine: engine.statusFor(userId),
    sentToday: journal.sentToday(userId),
    usage: usageSummary(userId),
    health
  });
});

// ── edit a draft (persist user edits before approve) ───────────────────────
router.patch('/leads/:id', requireToken, (req, res) => {
  const userId = req.userId;
  const { id } = req.params;
  const { subject, body, status } = req.body || {};
  let found = false;
  update(userId, (db) => {
    const lead = db.leads.find((l) => l.id === id);
    if (!lead) return;
    found = true;
    if (lead.draft && (subject != null || body != null)) {
      if (subject != null) lead.draft.subject = String(subject);
      if (body != null) lead.draft.body = String(body);
      lead.draft.editedByUser = true;
    }
    if (status && ['ready', 'rejected'].includes(status)) lead.status = status;
    lead.updatedAt = new Date().toISOString();
  });
  if (!found) return res.status(404).json({ error: 'lead not found' });
  res.json({ ok: true });
});

router.post('/leads/delete', requireToken, (req, res) => {
  const userId = req.userId;
  const ids = new Set(req.body?.ids || []);
  update(userId, (db) => { db.leads = db.leads.filter((l) => !ids.has(l.id)); });
  res.json({ ok: true, total: getState(userId).leads.length });
});

// ── pipeline actions ───────────────────────────────────────────────────────
router.post('/generate', requireToken, (req, res) => {
  const ids = req.body?.ids || [];
  const auto = !!req.body?.auto;
  const queued = engine.enqueueGeneration(req.userId, ids, { auto });
  res.json({ ok: true, queued, auto });
});

router.post('/approve', requireToken, (req, res) => {
  const queued = engine.approve(req.userId, req.body?.ids || []);
  res.json({ ok: true, queued });
});

router.post('/reject', requireToken, (req, res) => {
  engine.reject(req.userId, req.body?.ids || []);
  res.json({ ok: true });
});

router.post('/stop', requireToken, (req, res) => {
  engine.stopAll(req.userId);
  res.json({ ok: true });
});

router.post('/suppress', requireToken, (req, res) => {
  const email = req.body?.email;
  const ok = engine.suppress(req.userId, email);
  res.json({ ok });
});

// ── settings ───────────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  const s = loadSettings(req.userId);
  // Never send the full API key back to the browser — just whether it's set.
  res.json({
    ...s,
    resendApiKey: s.resendApiKey ? '••••' + s.resendApiKey.slice(-4) : '',
    hasResendKey: !!s.resendApiKey
  });
});

router.post('/settings', requireToken, (req, res) => {
  const userId = req.userId;
  const patch = req.body || {};
  // Ignore the masked key placeholder — only overwrite when a real key is sent.
  if (typeof patch.resendApiKey === 'string' && patch.resendApiKey.includes('••')) {
    delete patch.resendApiKey;
  }
  saveSettings(userId, patch);
  res.json({ ok: true, health: settingsHealth(userId) });
});

router.post('/test-email', requireToken, async (req, res) => {
  const userId = req.userId;
  const to = req.body?.to || loadSettings(userId).testInbox;
  if (!to) return res.status(400).json({ error: 'no recipient' });
  const result = await sendTestEmail(userId, to);
  res.json(result);
});
