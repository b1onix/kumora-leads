import { db, OWNER_USER_ID, newId, hashKey } from './db.js';

/**
 * User-scoped store over SQLite (server/db.js).
 *
 * Keeps the same ergonomics the routes/engine were written against:
 *   const state = getState(userId);              // { leads, campaigns, suppression }
 *   update(userId, (s) => { ...mutate s.leads... });
 *
 * update() loads the caller's working set, lets `fn` mutate it in place, then
 * diffs and persists inside a single SQLite transaction. Because Node is
 * single-threaded and there's no await between load and persist, each update()
 * is atomic per call — same guarantee the old JSON store gave, now per user.
 *
 * The `leads`/`campaigns` a caller sees are ONLY that user's rows, so tenant
 * isolation is enforced at the data layer, not in each route.
 */

export { newId, hashKey };

// ── row <-> object mapping ──────────────────────────────────────────────────

function leadFromRow(row) {
  const obj = JSON.parse(row.data);
  // The indexed columns are the source of truth for these three fields.
  obj.id = row.id;
  obj.status = row.status;
  obj.email = row.email || obj.email || '';
  return obj;
}

function dedupeKeyFor(lead) {
  return lead.key || lead.mapsUrl || `${lead.name}|${lead.address}`;
}

// ── read ────────────────────────────────────────────────────────────────────

/** Read-only snapshot of one user's data. */
export function getState(userId = OWNER_USER_ID) {
  const leads = db
    .prepare('SELECT id, status, email, data FROM leads WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId)
    .map(leadFromRow);
  const campaigns = db
    .prepare('SELECT id, query, count, created_at AS createdAt FROM campaigns WHERE user_id = ? ORDER BY created_at ASC')
    .all(userId);
  const suppression = db
    .prepare('SELECT email FROM suppression WHERE user_id = ?')
    .all(userId)
    .map((r) => r.email);
  return { leads, campaigns, suppression };
}

// ── write ───────────────────────────────────────────────────────────────────

const insLead = db.prepare(
  `INSERT INTO leads (id, user_id, dedupe_key, email, status, data, created_at, updated_at)
   VALUES (@id, @user_id, @dedupe_key, @email, @status, @data, @created_at, @updated_at)`
);
const updLead = db.prepare(
  `UPDATE leads SET dedupe_key=@dedupe_key, email=@email, status=@status, data=@data, updated_at=@updated_at
   WHERE id=@id AND user_id=@user_id`
);
const delLead = db.prepare('DELETE FROM leads WHERE id=@id AND user_id=@user_id');
const insCampaign = db.prepare(
  `INSERT INTO campaigns (id, user_id, query, count, created_at)
   VALUES (@id, @user_id, @query, @count, @created_at)
   ON CONFLICT(id) DO UPDATE SET query=excluded.query, count=excluded.count`
);
const insSuppress = db.prepare(
  `INSERT INTO suppression (user_id, email) VALUES (@user_id, @email) ON CONFLICT DO NOTHING`
);
const delSuppress = db.prepare('DELETE FROM suppression WHERE user_id=@user_id AND email=@email');

/**
 * Mutate one user's data. `fn` receives { leads, campaigns, suppression } and
 * mutates it in place (push/splice/assign), exactly like the old store. We snap
 * the ids before/after to compute inserts, updates, and deletes, and write them
 * all in one transaction. Returns whatever `fn` returns.
 */
export function update(userId, fn) {
  if (typeof userId === 'function') {
    // Back-compat guard: someone called update(fn) without a userId.
    fn = userId;
    userId = OWNER_USER_ID;
  }

  const state = getState(userId);
  const beforeLeadIds = new Set(state.leads.map((l) => l.id));
  const beforeSuppression = new Set(state.suppression);
  const beforeCampaignIds = new Set(state.campaigns.map((c) => c.id));

  const result = fn(state);

  const now = new Date().toISOString();
  const persist = db.transaction(() => {
    const afterLeadIds = new Set();
    for (const lead of state.leads) {
      afterLeadIds.add(lead.id);
      const row = {
        id: lead.id,
        user_id: userId,
        dedupe_key: dedupeKeyFor(lead),
        email: lead.email || '',
        status: lead.status || 'ready',
        data: JSON.stringify(lead),
        created_at: lead.createdAt || now,
        updated_at: lead.updatedAt || now
      };
      if (beforeLeadIds.has(lead.id)) updLead.run(row);
      else insLead.run(row);
    }
    // Deletions: rows that existed before but are gone now.
    for (const id of beforeLeadIds) {
      if (!afterLeadIds.has(id)) delLead.run({ id, user_id: userId });
    }

    // Campaigns are append/update-only in practice; upsert each.
    for (const c of state.campaigns) {
      if (beforeCampaignIds.has(c.id) && c.count === undefined) continue;
      insCampaign.run({
        id: c.id, user_id: userId, query: c.query || '', count: c.count || 0,
        created_at: c.createdAt || now
      });
    }

    // Suppression diff.
    const afterSuppression = new Set(state.suppression);
    for (const email of afterSuppression) {
      if (!beforeSuppression.has(email)) insSuppress.run({ user_id: userId, email });
    }
    for (const email of beforeSuppression) {
      if (!afterSuppression.has(email)) delSuppress.run({ user_id: userId, email });
    }
  });
  persist();

  return result;
}
