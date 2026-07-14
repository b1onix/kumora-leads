import { db, OWNER_USER_ID } from './db.js';

/**
 * Per-user send journal, backed by the `sends` table. This — not the leads
 * table — is the source of truth for "have I ever attempted/completed a send to
 * this address?". It survives crashes mid-send and hard-guards double-sends.
 *
 * Every function is scoped to a user_id so one tenant's cap/history can never
 * be affected by another's. Records mirror the old sends.jsonl shape:
 *   { ts, event:'attempt'|'sent'|'failed'|'dry', email, to, leadId,
 *     campaignId, idkey, resendId?, testMode?, error? }
 */

const insSend = db.prepare(
  `INSERT INTO sends (user_id, ts, event, email, to_addr, lead_id, campaign_id, idkey, resend_id, test_mode, error)
   VALUES (@user_id, @ts, @event, @email, @to_addr, @lead_id, @campaign_id, @idkey, @resend_id, @test_mode, @error)`
);

export function append(userId, record) {
  if (typeof userId === 'object') { record = userId; userId = OWNER_USER_ID; } // back-compat
  insSend.run({
    user_id: userId,
    ts: record.ts || new Date().toISOString(),
    event: record.event,
    email: record.email || null,
    to_addr: record.to || null,
    lead_id: record.leadId || null,
    campaign_id: record.campaignId || null,
    idkey: record.idkey || null,
    resend_id: record.resendId || null,
    test_mode: record.testMode ? 1 : 0,
    error: record.error || null
  });
}

/** Has a real (non-dry) 'sent' ever been recorded for this email address? */
export function alreadySent(userId, email) {
  if (email === undefined) { email = userId; userId = OWNER_USER_ID; } // back-compat
  const target = String(email || '').toLowerCase();
  if (!target) return false;
  const row = db
    .prepare(`SELECT 1 FROM sends WHERE user_id=? AND event='sent' AND email=? LIMIT 1`)
    .get(userId, target);
  return !!row;
}

/** How many real emails were sent today (local date), for the daily cap. */
export function sentToday(userId = OWNER_USER_ID) {
  const today = new Date().toDateString();
  const rows = db
    .prepare(`SELECT ts FROM sends WHERE user_id=? AND event='sent'`)
    .all(userId);
  return rows.filter((r) => new Date(r.ts).toDateString() === today).length;
}
