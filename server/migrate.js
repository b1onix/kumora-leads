import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './paths.js';
import { db, OWNER_USER_ID, ensureOwner } from './db.js';

/**
 * One-time migration of the legacy JSON files into SQLite under the owner user.
 * Idempotent: it records a marker row and skips if already run, and uses
 * INSERT-OR-IGNORE semantics so re-running never duplicates data.
 *
 *   data/db.json        → leads, campaigns, suppression
 *   data/sends.jsonl    → sends
 *   data/settings.json  → settings (owner)
 *
 * Legacy files are left on disk (renamed with a .migrated suffix) so nothing is
 * ever destroyed. Returns a summary of what was imported.
 */

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function alreadyMigrated() {
  const row = db.prepare('SELECT 1 FROM sends WHERE idkey = ? LIMIT 1').get('__migrated__');
  if (row) return true;
  // Or: owner already has leads (a prior partial run / fresh live use).
  const n = db.prepare('SELECT COUNT(*) AS c FROM leads WHERE user_id = ?').get(OWNER_USER_ID).c;
  return n > 0;
}

export function runMigration({ force = false } = {}) {
  ensureOwner();
  const summary = { ran: false, leads: 0, campaigns: 0, suppression: 0, sends: 0, settings: false };

  if (!force && alreadyMigrated()) {
    summary.reason = 'already migrated (owner has data)';
    return summary;
  }

  const now = new Date().toISOString();
  const dbJsonPath = path.join(DATA_DIR, 'db.json');
  const sendsPath = path.join(DATA_DIR, 'sends.jsonl');
  const settingsPath = path.join(DATA_DIR, 'settings.json');

  const legacy = readJson(dbJsonPath) || {};
  const leads = Array.isArray(legacy.leads) ? legacy.leads : [];
  const campaigns = Array.isArray(legacy.campaigns) ? legacy.campaigns : [];
  const suppression = Array.isArray(legacy.suppression) ? legacy.suppression : [];

  const insLead = db.prepare(
    `INSERT INTO leads (id, user_id, dedupe_key, email, status, data, created_at, updated_at)
     VALUES (@id, @user_id, @dedupe_key, @email, @status, @data, @created_at, @updated_at)
     ON CONFLICT(id) DO NOTHING`
  );
  const insCampaign = db.prepare(
    `INSERT INTO campaigns (id, user_id, query, count, created_at)
     VALUES (@id, @user_id, @query, @count, @created_at)
     ON CONFLICT(id) DO NOTHING`
  );
  const insSuppress = db.prepare(
    `INSERT INTO suppression (user_id, email) VALUES (@user_id, @email) ON CONFLICT DO NOTHING`
  );
  const insSend = db.prepare(
    `INSERT INTO sends (user_id, ts, event, email, to_addr, lead_id, campaign_id, idkey, resend_id, test_mode, error)
     VALUES (@user_id, @ts, @event, @email, @to_addr, @lead_id, @campaign_id, @idkey, @resend_id, @test_mode, @error)`
  );

  const tx = db.transaction(() => {
    for (const lead of leads) {
      const dedupeKey = lead.key || lead.mapsUrl || `${lead.name}|${lead.address}`;
      insLead.run({
        id: lead.id,
        user_id: OWNER_USER_ID,
        dedupe_key: dedupeKey,
        email: lead.email || '',
        status: lead.status || 'ready',
        data: JSON.stringify(lead),
        created_at: lead.createdAt || now,
        updated_at: lead.updatedAt || now
      });
      summary.leads++;
    }
    for (const c of campaigns) {
      insCampaign.run({
        id: c.id, user_id: OWNER_USER_ID, query: c.query || '',
        count: c.count || 0, created_at: c.createdAt || now
      });
      summary.campaigns++;
    }
    for (const email of suppression) {
      insSuppress.run({ user_id: OWNER_USER_ID, email: String(email).toLowerCase() });
      summary.suppression++;
    }

    // Sends journal (JSONL, one record per line).
    if (fs.existsSync(sendsPath)) {
      const lines = fs.readFileSync(sendsPath, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        insSend.run({
          user_id: OWNER_USER_ID,
          ts: r.ts || now,
          event: r.event,
          email: r.email || null,
          to_addr: r.to || null,
          lead_id: r.leadId || null,
          campaign_id: r.campaignId || null,
          idkey: r.idkey || null,
          resend_id: r.resendId || null,
          test_mode: r.testMode ? 1 : 0,
          error: r.error || null
        });
        summary.sends++;
      }
    }

    // Settings.
    const savedSettings = readJson(settingsPath);
    if (savedSettings && typeof savedSettings === 'object') {
      db.prepare(
        `INSERT INTO settings (user_id, data) VALUES (@user_id, @data)
         ON CONFLICT(user_id) DO UPDATE SET data = excluded.data`
      ).run({ user_id: OWNER_USER_ID, data: JSON.stringify(savedSettings) });
      summary.settings = true;
    }

    // Marker so we never re-import on top of live data.
    insSend.run({
      user_id: OWNER_USER_ID, ts: now, event: 'migration', email: null, to_addr: null,
      lead_id: null, campaign_id: null, idkey: '__migrated__', resend_id: null, test_mode: 0, error: null
    });
  });
  tx();

  // Archive the legacy files (never delete) so a re-run can't double-import and
  // the originals remain recoverable.
  for (const p of [dbJsonPath, sendsPath, settingsPath]) {
    if (fs.existsSync(p)) {
      try { fs.renameSync(p, p + '.migrated'); } catch { /* leave in place */ }
    }
  }

  summary.ran = true;
  return summary;
}

// Allow running standalone: `node server/migrate.js` (add --force to re-import).
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('migrate.js')) {
  const force = process.argv.includes('--force');
  const res = runMigration({ force });
  console.log('[migrate]', JSON.stringify(res, null, 2));
}
