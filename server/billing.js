import express from 'express';
import crypto from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import { PLANS, usageSummary } from './plans.js';
import { resolveRequestUser, getUserById } from './auth.js';

/**
 * Stripe subscriptions without the Stripe SDK — plain fetch against the REST
 * API and manual webhook signature verification (HMAC-SHA256 over
 * "<timestamp>.<raw body>"), keeping with this project's no-extra-deps style.
 *
 * Flow:
 *   1. POST /api/billing/checkout {plan} → Stripe Checkout Session → {url}
 *   2. User pays on Stripe's hosted page.
 *   3. Stripe calls POST /api/stripe/webhook → we flip users.plan.
 *   4. Subscription cancelled/unpaid → webhook flips the user back to free.
 *
 * The webhook is mounted with a RAW body parser (index.js mounts this router
 * before express.json) because signature verification needs the exact bytes.
 */

export const billingRouter = express.Router();

// Older databases predate these columns; add them on boot if missing.
for (const col of ['stripe_customer_id TEXT', 'stripe_subscription_id TEXT']) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch { /* already exists */ }
}

export function billingConfigured() {
  return !!(config.stripeSecretKey && config.stripePricePro && config.stripePriceUltra);
}

function priceFor(planKey) {
  return planKey === 'pro' ? config.stripePricePro
    : planKey === 'ultra' ? config.stripePriceUltra
    : null;
}

async function stripe(path, params) {
  const res = await fetch('https://api.stripe.com/v1/' + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(params).toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Stripe HTTP ${res.status}`);
  }
  return data;
}

// ── plan catalog + current state (for the Billing page) ─────────────────────
billingRouter.get('/billing', (req, res) => {
  const userId = resolveRequestUser(req);
  if (!userId) return res.status(401).json({ error: 'not authenticated' });

  const catalog = ['free', 'pro', 'ultra'].map((key) => ({
    key,
    label: PLANS[key].label,
    priceMonthly: PLANS[key].priceMonthly,
    leadsPerMonth: PLANS[key].leadsPerMonth,
    emailsPerMonth: PLANS[key].emailsPerMonth,
    customAI: PLANS[key].customAI
  }));

  res.json({
    configured: billingConfigured(),
    plans: catalog,
    usage: usageSummary(userId)
  });
});

// ── start a checkout ─────────────────────────────────────────────────────────
billingRouter.post('/billing/checkout', async (req, res) => {
  const userId = resolveRequestUser(req);
  if (!userId) return res.status(401).json({ error: 'not authenticated' });

  const plan = String(req.body?.plan || '');
  if (plan !== 'pro' && plan !== 'ultra') {
    return res.status(400).json({ error: 'unknown plan', code: 'bad_plan' });
  }
  if (!billingConfigured()) {
    return res.status(503).json({
      error: 'billing is not configured yet — purchasing will open soon',
      code: 'billing_unconfigured'
    });
  }
  const price = priceFor(plan);

  const user = getUserById(userId);
  const base = config.publicUrl || 'https://kumora.io';
  try {
    const session = await stripe('checkout/sessions', {
      mode: 'subscription',
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      customer_email: user?.email || '',
      client_reference_id: userId,
      'metadata[userId]': userId,
      'metadata[plan]': plan,
      'subscription_data[metadata][userId]': userId,
      'subscription_data[metadata][plan]': plan,
      success_url: `${base}/#/billing?upgraded=${plan}`,
      cancel_url: `${base}/#/billing`
    });
    res.json({ ok: true, url: session.url });
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// ── webhook ──────────────────────────────────────────────────────────────────

/** Verify Stripe-Signature over the raw payload. Returns the parsed event or null. */
export function verifyStripeEvent(rawBody, signatureHeader, secret) {
  if (!secret || !signatureHeader) return null;
  const parts = Object.fromEntries(
    String(signatureHeader).split(',').map((p) => p.split('=').map((s) => s.trim()))
  );
  const timestamp = parts.t;
  const given = parts.v1;
  if (!timestamp || !given) return null;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  // Reject events older than 5 minutes (replay protection).
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;

  try { return JSON.parse(rawBody); } catch { return null; }
}

function setPlan(userId, plan, { customerId, subscriptionId } = {}) {
  db.prepare(
    `UPDATE users SET plan = @plan, plan_status = 'active',
       stripe_customer_id = COALESCE(@customerId, stripe_customer_id),
       stripe_subscription_id = COALESCE(@subscriptionId, stripe_subscription_id),
       updated_at = @now
     WHERE id = @userId`
  ).run({ userId, plan, customerId: customerId || null, subscriptionId: subscriptionId || null, now: new Date().toISOString() });
}

function downgradeByCustomer(customerId) {
  db.prepare(
    `UPDATE users SET plan = 'free', plan_status = 'active', stripe_subscription_id = NULL, updated_at = ?
     WHERE stripe_customer_id = ?`
  ).run(new Date().toISOString(), customerId);
}

/** Raw-body webhook handler — export mounted directly in index.js. */
export function stripeWebhook(req, res) {
  const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
  const event = verifyStripeEvent(raw, req.get('Stripe-Signature'), config.stripeWebhookSecret);
  if (!event) return res.status(400).json({ error: 'bad signature' });

  const obj = event.data?.object || {};
  switch (event.type) {
    case 'checkout.session.completed': {
      const userId = obj.metadata?.userId || obj.client_reference_id;
      const plan = obj.metadata?.plan;
      if (userId && (plan === 'pro' || plan === 'ultra')) {
        setPlan(userId, plan, { customerId: obj.customer, subscriptionId: obj.subscription });
        console.log(`[billing] ${userId} upgraded to ${plan}`);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      if (obj.customer) {
        downgradeByCustomer(obj.customer);
        console.log(`[billing] subscription ended for customer ${obj.customer} → free`);
      }
      break;
    }
    case 'customer.subscription.updated': {
      // Past-due / unpaid subscriptions behave as free until they recover.
      const status = obj.status;
      const userId = obj.metadata?.userId;
      if (userId && ['past_due', 'unpaid', 'incomplete_expired', 'canceled'].includes(status)) {
        db.prepare(`UPDATE users SET plan_status = 'lapsed', updated_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), userId);
      } else if (userId && status === 'active') {
        db.prepare(`UPDATE users SET plan_status = 'active', updated_at = ? WHERE id = ?`)
          .run(new Date().toISOString(), userId);
      }
      break;
    }
    default:
      break; // ignore everything else
  }

  res.json({ received: true });
}
