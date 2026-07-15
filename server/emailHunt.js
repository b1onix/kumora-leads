import { getState, update } from './store.js';

/**
 * Server-side email hunting.
 *
 * This used to live in the extension's service worker, which forced the
 * extension to request <all_urls> host permissions (business websites can be
 * on any domain). Moving it here lets the extension ship with access to
 * kumora.io only — and means emails are found where quotas live.
 *
 * After an import, leads that arrived without an email but WITH a website are
 * queued here. We fetch the site (and up to two contact-style pages), extract
 * candidate addresses, pick the most plausible one, and write it onto the
 * lead — flipping its status from no_email to ready so it can be drafted.
 *
 * The extraction heuristics are ported unchanged from the extension's
 * original hunter (mailto links, Cloudflare-obfuscated addresses, plain-text
 * matches, junk filtering, prefix ranking).
 */

const FETCH_TIMEOUT_MS = 9000;
const MAX_CONTACT_PAGES = 2;
const MAX_HTML_BYTES = 600_000;
const HUNT_CONCURRENCY = 3;

const SKIP_HOSTS = [
  'facebook.com', 'm.facebook.com', 'instagram.com', 'linkedin.com',
  'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'wa.me',
  'whatsapp.com', 'goo.gl'
];

const JUNK_EMAIL_PATTERNS = [
  /\.(png|jpe?g|gif|webp|svg|ico|css|js|woff2?)$/i,
  /(^|@)(example|sentry|wixpress|sentry-next|schema)\./i,
  /^(noreply|no-reply|donotreply|do-not-reply)@/i,
  /^[0-9a-f]{20,}@/i,
  /@(2x|3x)\./i,
  /^(email|your|name|user|username|info)@(email|example|domain|company|test|yoursite|website)\./i
];

const PREFERRED_PREFIXES = [
  'info', 'contact', 'office', 'hello', 'sales', 'mail', 'support',
  'kontakt', 'service', 'admin', 'team', 'inquiries', 'enquiries'
];

// ── the hunt itself ──────────────────────────────────────────────────────────

export async function huntEmail(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) return '';

  const host = safeHost(url);
  if (!host || SKIP_HOSTS.some((s) => host === s || host.endsWith('.' + s))) return '';

  const found = new Set();
  const homepageHtml = await fetchHtml(url);

  if (homepageHtml) {
    extractEmails(homepageHtml).forEach((e) => found.add(e));
    if (found.size === 0) {
      const candidates = findContactLinks(homepageHtml, url).slice(0, MAX_CONTACT_PAGES);
      for (const link of candidates) {
        const html = await fetchHtml(link);
        if (html) extractEmails(html).forEach((e) => found.add(e));
        if (found.size > 0) break;
      }
    }
  }

  return pickBestEmail([...found], host);
}

function normalizeUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { return new URL(u).href; } catch { return null; }
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return null; }
}

async function fetchHtml(url) {
  const attempt = async (target) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(target, {
        signal: ctrl.signal,
        redirect: 'follow',
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Mozilla/5.0 (compatible; KumoraBot/1.0)'
        }
      });
      if (!res.ok) return null;
      const type = res.headers.get('content-type') || '';
      if (type && !/text\/html|application\/xhtml/i.test(type)) return null;
      const text = await res.text();
      return text.slice(0, MAX_HTML_BYTES);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  let html = await attempt(url);
  if (!html) {
    const swapped = url.startsWith('https://')
      ? url.replace(/^https:\/\//, 'http://')
      : url.replace(/^http:\/\//, 'https://');
    html = await attempt(swapped);
  }
  return html;
}

function extractEmails(html) {
  const found = new Set();
  let m;

  const mailtoRe = /mailto:([^"'?\s>]+)/gi;
  while ((m = mailtoRe.exec(html)) !== null) {
    const e = cleanEmail(safeDecode(m[1]));
    if (e) found.add(e);
  }

  const cfRe = /data-cfemail="([0-9a-f]+)"/gi;
  while ((m = cfRe.exec(html)) !== null) {
    const e = cleanEmail(decodeCfEmail(m[1]));
    if (e) found.add(e);
  }

  const plainRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,10}/g;
  while ((m = plainRe.exec(html)) !== null) {
    const e = cleanEmail(m[0]);
    if (e) found.add(e);
  }

  return [...found];
}

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

function decodeCfEmail(hex) {
  try {
    const key = parseInt(hex.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
    }
    return out;
  } catch {
    return '';
  }
}

function cleanEmail(raw) {
  if (!raw) return null;
  const e = raw.trim().toLowerCase().replace(/^[.,;:]+|[.,;:]+$/g, '');
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,10}$/.test(e)) return null;
  if (e.length > 64) return null;
  if (JUNK_EMAIL_PATTERNS.some((re) => re.test(e))) return null;
  return e;
}

function findContactLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const hrefRe = /href\s*=\s*["']([^"'#]+)["']/gi;
  const keywords = /contact|kontakt|impressum|about|reach-?us|get-?in-?touch|support/i;
  const links = [];
  const seen = new Set();
  let m;
  while ((m = hrefRe.exec(html)) !== null && links.length < 8) {
    const href = m[1];
    if (!keywords.test(href)) continue;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const abs = new URL(href, base);
      if (abs.hostname !== base.hostname) continue;
      if (seen.has(abs.href)) continue;
      seen.add(abs.href);
      links.push(abs.href);
    } catch { /* malformed href */ }
  }
  links.sort((a, b) => score(b) - score(a));
  return links;

  function score(u) {
    if (/contact|kontakt/i.test(u)) return 2;
    if (/impressum/i.test(u)) return 1;
    return 0;
  }
}

function pickBestEmail(emails, siteHost) {
  if (emails.length === 0) return '';
  const ranked = [...emails].sort((a, b) => rank(b) - rank(a));
  return ranked[0];

  function rank(email) {
    let r = 0;
    const [prefix, domain] = email.split('@');
    if (siteHost && (domain === siteHost || siteHost.endsWith('.' + domain) || domain.endsWith('.' + siteHost))) {
      r += 10;
    }
    const pi = PREFERRED_PREFIXES.indexOf(prefix);
    if (pi !== -1) r += PREFERRED_PREFIXES.length - pi;
    if (/gmail\.com|yahoo\.|hotmail\.|outlook\./.test(domain)) r += 3;
    return r;
  }
}

// ── background queue (post-import) ──────────────────────────────────────────

const queue = []; // { userId, leadId }
let active = 0;

/** Queue email hunts for freshly imported leads. Fire-and-forget. */
export function enqueueHunts(userId, leadIds) {
  for (const leadId of leadIds) queue.push({ userId, leadId });
  pump();
  return queue.length;
}

function pump() {
  while (active < HUNT_CONCURRENCY && queue.length > 0) {
    const job = queue.shift();
    active++;
    runHunt(job).finally(() => {
      active--;
      pump();
    });
  }
}

async function runHunt({ userId, leadId }) {
  const lead = getState(userId).leads.find((l) => l.id === leadId);
  if (!lead || lead.email || !lead.website) return;

  let email = '';
  try {
    email = await huntEmail(lead.website);
  } catch {
    email = '';
  }
  if (!email) return; // stays no_email — user can still see/handle it

  update(userId, (db) => {
    const l = db.leads.find((x) => x.id === leadId);
    if (!l || l.email) return;
    l.email = email;
    if (l.status === 'no_email') l.status = 'ready';
    l.updatedAt = new Date().toISOString();
  });
  console.log(`[emailhunt] found ${email} for ${lead.name}`);
}
