import { Resend } from 'resend';
import { loadSettings } from './config.js';
import * as journal from './journal.js';
import { hashKey } from './store.js';
import { emailQuotaExceeded, bumpUsage } from './plans.js';

/**
 * All real email sending lives here, behind guards that protect BOTH manual
 * and auto mode:
 *   1. suppression list (unsubs/bounces/manual blocks)
 *   2. journal — refuse to re-send to an address we've already emailed
 *   3. daily cap
 *   4. test mode — reroute to the user's own inbox
 * The compliance footer (physical address + opt-out) is appended here, never
 * written by the model.
 */

let resendClient = null;
let resendKeyUsed = null;

function getResend(apiKey) {
  if (!apiKey) return null;
  if (!resendClient || resendKeyUsed !== apiKey) {
    resendClient = new Resend(apiKey);
    resendKeyUsed = apiKey;
  }
  return resendClient;
}

export function buildFooter(settings) {
  const lines = ['', '--'];
  if (settings.senderCompany) lines.push(settings.senderCompany);
  if (settings.physicalAddress) lines.push(settings.physicalAddress);
  const optOut = settings.unsubscribeMailto
    ? `Don't want to hear from me? Reply "unsubscribe" or email ${settings.unsubscribeMailto} and I won't write again.`
    : `Don't want to hear from me? Just reply "unsubscribe" and I won't write again.`;
  lines.push(optOut);
  return lines.join('\n');
}

/**
 * Check every gate before a send is allowed.
 * Returns { allowed: true } or { allowed: false, reason }.
 */
export function sendGuards(userId, lead, state, settings) {
  const email = String(lead.email || '').toLowerCase();
  if (!email) return { allowed: false, reason: 'lead has no email' };
  if (!lead.draft || !lead.draft.subject || !lead.draft.body) {
    return { allowed: false, reason: 'no draft to send' };
  }
  if (state.suppression.includes(email)) {
    return { allowed: false, reason: 'address is on the suppression list' };
  }
  if (!settings.testMode && journal.alreadySent(userId, email)) {
    return { allowed: false, reason: 'already emailed this address before (journal)' };
  }
  if (!settings.testMode && emailQuotaExceeded(userId)) {
    return { allowed: false, reason: 'monthly email limit reached — upgrade your plan to keep sending' };
  }
  if (!settings.testMode && journal.sentToday(userId) >= settings.dailyCap) {
    return { allowed: false, reason: `daily cap reached (${settings.dailyCap})` };
  }
  if (!settings.resendApiKey) return { allowed: false, reason: 'Resend API key not configured' };
  if (!settings.fromEmail) return { allowed: false, reason: 'From email not configured' };
  if (settings.testMode && !settings.testInbox) {
    return { allowed: false, reason: 'Test mode is on but no test inbox is set' };
  }
  return { allowed: true };
}

/**
 * Send one lead's approved draft. Assumes guards passed. Journals the attempt
 * BEFORE the network call so a crash can never cause a silent double-send
 * (the idempotency key makes a retry after crash safe too).
 * Returns { ok, resendId?, error?, permanent? }.
 */
export async function sendLead(userId, lead, settings) {
  const resend = getResend(settings.resendApiKey);
  const realEmail = String(lead.email).toLowerCase();
  const to = settings.testMode ? settings.testInbox : realEmail;
  const idempotencyKey = `lex-${lead.campaignId || 'nc'}-${hashKey(lead.key || lead.id)}`;

  const subject = settings.testMode ? `[TEST → ${realEmail}] ${lead.draft.subject}` : lead.draft.subject;
  const text = lead.draft.body + buildFooter(settings);

  journal.append(userId, {
    event: 'attempt',
    email: realEmail,
    to,
    leadId: lead.id,
    campaignId: lead.campaignId || null,
    idkey: idempotencyKey,
    testMode: !!settings.testMode
  });

  const payload = {
    from: `${settings.fromName} <${settings.fromEmail}>`,
    to,
    subject,
    text,
    ...(settings.replyTo ? { replyTo: settings.replyTo } : {}),
    headers: {
      'List-Unsubscribe': settings.unsubscribeMailto
        ? `<mailto:${settings.unsubscribeMailto}?subject=unsubscribe>`
        : `<mailto:${settings.replyTo || settings.fromEmail}?subject=unsubscribe>`
    }
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    let data, error;
    try {
      ({ data, error } = await resend.emails.send(payload, { idempotencyKey }));
    } catch (netErr) {
      // Network-level failure — retry with the same idempotency key.
      error = { name: 'network_error', message: String(netErr.message || netErr) };
    }

    if (!error && data && data.id) {
      journal.append(userId, {
        event: settings.testMode ? 'dry' : 'sent',
        email: realEmail,
        to,
        leadId: lead.id,
        campaignId: lead.campaignId || null,
        idkey: idempotencyKey,
        resendId: data.id,
        testMode: !!settings.testMode
      });
      // Only real deliveries consume plan quota — test-mode dry runs are free.
      if (!settings.testMode) bumpUsage(userId, { emails: 1 });
      return { ok: true, resendId: data.id };
    }

    const name = error?.name || 'unknown_error';
    const message = error?.message || 'unknown Resend error';

    if (name === 'rate_limit_exceeded' || name === 'network_error') {
      if (attempt < 3) {
        await sleep(1200 * attempt);
        continue;
      }
    }

    const permanent = !['rate_limit_exceeded', 'network_error', 'internal_server_error', 'application_error'].includes(name);
    journal.append(userId, {
      event: 'failed', email: realEmail, leadId: lead.id,
      campaignId: lead.campaignId || null, idkey: idempotencyKey,
      error: `${name}: ${message}`
    });
    return { ok: false, error: `${name}: ${message}`, permanent };
  }

  return { ok: false, error: 'retries exhausted' };
}

/** Send a standalone test email to the user's own inbox. */
export async function sendTestEmail(userId, toAddress) {
  const settings = loadSettings(userId);
  if (!settings.resendApiKey) return { ok: false, error: 'Resend API key not configured' };
  if (!settings.fromEmail || !settings.fromName) return { ok: false, error: 'From name/email not configured' };

  const resend = getResend(settings.resendApiKey);
  const body =
    `Hey — this is a test email from your LeadExtractor dashboard.\n\n` +
    `If you're reading this, Resend is wired up correctly and your from-address works.` +
    buildFooter(settings);
  try {
    const { data, error } = await resend.emails.send({
      from: `${settings.fromName} <${settings.fromEmail}>`,
      to: toAddress,
      subject: 'leadextractor test — you are good to go',
      text: body,
      ...(settings.replyTo ? { replyTo: settings.replyTo } : {})
    });
    if (error) return { ok: false, error: `${error.name || 'error'}: ${error.message || ''}` };
    return { ok: true, resendId: data?.id };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
