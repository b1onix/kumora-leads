import { db, OWNER_USER_ID } from './db.js';

/**
 * Subscription plans and monthly usage accounting.
 *
 * Every account starts on FREE. PRO and ULTRA are purchased (Stripe — see
 * billing.js). Limits are enforced server-side at the two spots that matter:
 * lead import (routes.js) and real email sends (mailer.js). The DeepSeek key
 * is always the platform's own — users never bring their own model key.
 *
 * Usage is tracked in a per-user, per-calendar-month row that only ever
 * increments. Deleting leads does NOT refund extraction quota (otherwise
 * import→export→delete would make quotas meaningless).
 */

export const PLANS = {
  free: {
    label: 'Free',
    leadsPerMonth: 1_000,
    emailsPerMonth: 1_000,
    customAI: false,
    priceMonthly: 0
  },
  pro: {
    label: 'Pro',
    leadsPerMonth: 10_000,
    emailsPerMonth: 50_000,
    customAI: true,
    priceMonthly: 29
  },
  ultra: {
    label: 'Ultra',
    leadsPerMonth: 100_000,
    emailsPerMonth: 100_000,
    customAI: true,
    priceMonthly: 79
  },
  // The platform owner's own account — no limits.
  owner: {
    label: 'Owner',
    leadsPerMonth: Infinity,
    emailsPerMonth: Infinity,
    customAI: true,
    priceMonthly: 0
  }
};

db.exec(`
  CREATE TABLE IF NOT EXISTS usage (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month   TEXT NOT NULL,
    leads   INTEGER NOT NULL DEFAULT 0,
    emails  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, month)
  );
`);

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** The user's plan key, defaulting to free if the row holds something unknown. */
export function getUserPlan(userId) {
  const row = db.prepare('SELECT plan, plan_status FROM users WHERE id = ?').get(userId);
  if (!row) return 'free';
  // A lapsed subscription behaves as free until the webhook reactivates it.
  if (row.plan !== 'owner' && row.plan_status && row.plan_status !== 'active') return 'free';
  return PLANS[row.plan] ? row.plan : 'free';
}

export function planLimits(planKey) {
  return PLANS[planKey] || PLANS.free;
}

const getUsageStmt = db.prepare('SELECT leads, emails FROM usage WHERE user_id = ? AND month = ?');
const bumpStmt = db.prepare(
  `INSERT INTO usage (user_id, month, leads, emails) VALUES (@user_id, @month, @leads, @emails)
   ON CONFLICT(user_id, month) DO UPDATE SET leads = leads + excluded.leads, emails = emails + excluded.emails`
);

export function getUsage(userId) {
  const row = getUsageStmt.get(userId, currentMonth());
  return { leads: row?.leads || 0, emails: row?.emails || 0 };
}

export function bumpUsage(userId, { leads = 0, emails = 0 }) {
  bumpStmt.run({ user_id: userId, month: currentMonth(), leads, emails });
}

/** Everything the UI needs to render plan state and meters. */
export function usageSummary(userId) {
  const plan = getUserPlan(userId);
  const limits = planLimits(plan);
  const used = getUsage(userId);
  const num = (v) => (Number.isFinite(v) ? v : null); // Infinity → null ("unlimited") for JSON
  return {
    plan,
    planLabel: limits.label,
    customAI: limits.customAI,
    leads: { used: used.leads, limit: num(limits.leadsPerMonth) },
    emails: { used: used.emails, limit: num(limits.emailsPerMonth) }
  };
}

/** How many more leads this user may extract this month (Infinity = unlimited). */
export function leadsRemaining(userId) {
  const limits = planLimits(getUserPlan(userId));
  if (!Number.isFinite(limits.leadsPerMonth)) return Infinity;
  return Math.max(0, limits.leadsPerMonth - getUsage(userId).leads);
}

/** Has the user hit their monthly real-send limit? */
export function emailQuotaExceeded(userId) {
  const limits = planLimits(getUserPlan(userId));
  if (!Number.isFinite(limits.emailsPerMonth)) return false;
  return getUsage(userId).emails >= limits.emailsPerMonth;
}

export { OWNER_USER_ID };
