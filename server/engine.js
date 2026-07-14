import { getState, update } from './store.js';
import { loadSettings } from './config.js';
import { generateDraft } from './draft.js';
import { sendLead, sendGuards } from './mailer.js';

/**
 * The pipeline engine. Owns the per-lead state machine and concurrency-limited
 * generation + sending workers. Both manual and auto mode run through the SAME
 * machine — auto mode just auto-approves drafted leads.
 *
 * Multi-tenant: all queue/worker state is kept PER USER in `tenants`, so one
 * account's generation/sending never blocks or mixes with another's. Each
 * tenant gets its own genQueue/sendQueue/counters/status.
 *
 * States: no_email | ready | queued | generating | drafted | approved
 *         | sending | sent | draft_failed | send_failed | rejected | suppressed
 */

const GEN_CONCURRENCY = 2;
const SEND_SPACING_MS = 4000; // polite gap between real sends

/** Lazily-created per-user engine state. */
const tenants = new Map();

function tenant(userId) {
  let t = tenants.get(userId);
  if (!t) {
    t = {
      genQueue: [],
      sendQueue: [],
      genActive: 0,
      sending: false,
      lastSendAt: 0,
      status: {
        generating: false,
        sending: false,
        genRemaining: 0,
        sendRemaining: 0,
        lastEvent: ''
      }
    };
    tenants.set(userId, t);
  }
  return t;
}

/** Public: read a user's live engine status (for /state). */
export function statusFor(userId) {
  return tenant(userId).status;
}

function setLead(userId, id, patch) {
  update(userId, (db) => {
    const lead = db.leads.find((l) => l.id === id);
    if (lead) Object.assign(lead, patch, { updatedAt: new Date().toISOString() });
  });
}

function getLead(userId, id) {
  return getState(userId).leads.find((l) => l.id === id) || null;
}

function log(t, msg) {
  t.status.lastEvent = msg;
  console.log('[engine]', msg);
}

// ─────────────────────────────────────────────────────────── generation

export function enqueueGeneration(userId, ids, { auto = false } = {}) {
  const t = tenant(userId);
  let queued = 0;
  update(userId, (db) => {
    for (const id of ids) {
      const lead = db.leads.find((l) => l.id === id);
      if (!lead) continue;
      if (!lead.email) { lead.status = 'no_email'; continue; }
      if (['queued', 'generating', 'sending'].includes(lead.status)) continue;
      // Allow (re)generation from ready/drafted/failed/rejected states.
      lead.status = 'queued';
      lead.auto = auto;
      lead.error = null;
      lead.updatedAt = new Date().toISOString();
      t.genQueue.push(id);
      queued++;
    }
  });
  t.status.genRemaining = t.genQueue.length;
  pumpGeneration(userId);
  return queued;
}

function pumpGeneration(userId) {
  const t = tenant(userId);
  while (t.genActive < GEN_CONCURRENCY && t.genQueue.length > 0) {
    const id = t.genQueue.shift();
    t.status.genRemaining = t.genQueue.length;
    const lead = getLead(userId, id);
    if (!lead || lead.status !== 'queued') continue;
    t.genActive++;
    t.status.generating = true;
    runGeneration(userId, id).finally(() => {
      t.genActive--;
      if (t.genActive === 0 && t.genQueue.length === 0) t.status.generating = false;
      pumpGeneration(userId);
    });
  }
}

async function runGeneration(userId, id) {
  const t = tenant(userId);
  const settings = loadSettings(userId);
  setLead(userId, id, { status: 'generating' });
  const lead = getLead(userId, id);
  if (!lead) return;
  log(t, `drafting ${lead.name}`);

  const res = await generateDraft(lead, settings);
  if (!res.ok) {
    const attempts = (getLead(userId, id)?.draftAttempts || 0) + 1;
    setLead(userId, id, { status: 'draft_failed', error: res.error, draftAttempts: attempts });
    log(t, `draft failed for ${lead.name}: ${res.error}`);
    return;
  }

  setLead(userId, id, { status: 'drafted', draft: res.draft, cost: res.cost, error: null });
  log(t, `drafted ${lead.name}`);

  // Auto mode: approve immediately and queue for sending.
  if (lead.auto) {
    approve(userId, [id]);
  }
}

// ─────────────────────────────────────────────────────────── approval / send

export function approve(userId, ids) {
  const t = tenant(userId);
  const toSend = [];
  update(userId, (db) => {
    for (const id of ids) {
      const lead = db.leads.find((l) => l.id === id);
      if (!lead) continue;
      if (lead.status !== 'drafted' && lead.status !== 'send_failed') continue;
      lead.status = 'approved';
      lead.updatedAt = new Date().toISOString();
      toSend.push(id);
    }
  });
  for (const id of toSend) {
    if (!t.sendQueue.includes(id)) t.sendQueue.push(id);
  }
  t.status.sendRemaining = t.sendQueue.length;
  pumpSending(userId);
  return toSend.length;
}

export function reject(userId, ids) {
  update(userId, (db) => {
    for (const id of ids) {
      const lead = db.leads.find((l) => l.id === id);
      if (lead && ['drafted', 'draft_failed', 'approved'].includes(lead.status)) {
        lead.status = 'rejected';
        lead.updatedAt = new Date().toISOString();
      }
    }
  });
}

async function pumpSending(userId) {
  const t = tenant(userId);
  if (t.sending) return;
  t.sending = true;
  t.status.sending = true;

  while (t.sendQueue.length > 0) {
    const id = t.sendQueue.shift();
    t.status.sendRemaining = t.sendQueue.length;
    const lead = getLead(userId, id);
    if (!lead || lead.status !== 'approved') continue;

    const settings = loadSettings(userId);
    const state = getState(userId);
    const guard = sendGuards(userId, lead, state, settings);
    if (!guard.allowed) {
      setLead(userId, id, { status: 'send_failed', error: guard.reason });
      log(t, `send blocked for ${lead.name}: ${guard.reason}`);
      continue;
    }

    // Space out real sends to protect deliverability.
    const wait = Math.max(0, SEND_SPACING_MS - (Date.now() - t.lastSendAt));
    if (wait > 0 && !settings.testMode) await sleep(wait);

    setLead(userId, id, { status: 'sending' });
    log(t, `sending to ${lead.name}`);
    const res = await sendLead(userId, lead, settings);
    t.lastSendAt = Date.now();

    if (res.ok) {
      setLead(userId, id, { status: 'sent', resendId: res.resendId, sentAt: new Date().toISOString(), error: null });
      log(t, `sent to ${lead.name}`);
    } else {
      const attempts = (getLead(userId, id)?.sendAttempts || 0) + 1;
      // Transient failures can be retried by re-approving; permanent ones stay failed.
      setLead(userId, id, { status: 'send_failed', error: res.error, sendAttempts: attempts });
      log(t, `send failed for ${lead.name}: ${res.error}`);
    }
  }

  t.sending = false;
  t.status.sending = false;
}

// ─────────────────────────────────────────────────────────── controls

export function stopAll(userId) {
  const t = tenant(userId);
  t.genQueue.length = 0;
  t.sendQueue.length = 0;
  t.status.genRemaining = 0;
  t.status.sendRemaining = 0;
  log(t, 'queues cleared (stop requested)');
}

export function suppress(userId, email) {
  const addr = String(email || '').toLowerCase().trim();
  if (!addr) return false;
  update(userId, (db) => {
    if (!db.suppression.includes(addr)) db.suppression.push(addr);
    for (const lead of db.leads) {
      if (String(lead.email || '').toLowerCase() === addr && lead.status !== 'sent') {
        lead.status = 'suppressed';
      }
    }
  });
  return true;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
