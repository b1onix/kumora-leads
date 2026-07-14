/**
 * Server-side website reader.
 *
 * The old Claude CLI could browse the lead's site itself (WebFetch). DeepSeek's
 * API cannot, so we do the fetching here and hand the model a plain-text
 * snippet to personalize from. The fetch + host-skip approach mirrors the
 * extension's email hunter (background.js) so behaviour stays consistent.
 *
 * We deliberately keep this cheap: homepage + at most one "about/services"
 * page, tight timeout, hard byte cap, HTML stripped to readable text.
 */

const FETCH_TIMEOUT_MS = 9000;
const MAX_HTML_BYTES = 600_000;
const MAX_SNIPPET_CHARS = 2000;

// Sites where fetching won't yield anything useful to personalize from.
const SKIP_HOSTS = [
  'facebook.com', 'm.facebook.com', 'instagram.com', 'linkedin.com',
  'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'wa.me',
  'whatsapp.com', 'goo.gl'
];

/**
 * Fetch a lead's website and return a short text snippet describing the
 * business, or null if nothing usable was found / the site was unreachable.
 * Never throws — personalization is best-effort.
 */
export async function fetchWebsiteSnippet(rawUrl) {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;

  const host = safeHost(url);
  if (!host || SKIP_HOSTS.some((s) => host === s || host.endsWith('.' + s))) return null;

  const homepageHtml = await fetchHtml(url);
  if (!homepageHtml) return null;

  let snippet = htmlToText(homepageHtml);

  // Thin homepage (e.g. a JS-rendered shell): try one about/services page.
  if (snippet.length < 200) {
    const link = findInfoLink(homepageHtml, url);
    if (link) {
      const sub = await fetchHtml(link);
      if (sub) {
        const subText = htmlToText(sub);
        if (subText.length > snippet.length) snippet = subText;
      }
    }
  }

  snippet = snippet.slice(0, MAX_SNIPPET_CHARS).trim();
  return snippet.length >= 60 ? snippet : null;
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
          // A real UA — some sites 403 the default fetch agent.
          'User-Agent': 'Mozilla/5.0 (compatible; LeadExtractorBot/1.0)'
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
  // Some old business sites only answer on http:// (or vice versa) — retry once.
  if (!html) {
    const swapped = url.startsWith('https://')
      ? url.replace(/^https:\/\//, 'http://')
      : url.replace(/^http:\/\//, 'https://');
    html = await attempt(swapped);
  }
  return html;
}

/** Prefer the meta description + visible copy; drop scripts, styles, tags. */
function htmlToText(html) {
  // Pull the meta description first — it's usually a clean business summary.
  let metaDesc = '';
  const m = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']description["']/i);
  if (m) metaDesc = decodeEntities(m[1]).trim();

  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(body)
    .replace(/\s+/g, ' ')
    .trim();

  return [title, metaDesc, text].filter(Boolean).join('. ');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return ' '; }
    });
}

/** Find one same-site about/services page worth reading if the homepage is thin. */
function findInfoLink(html, baseUrl) {
  const base = new URL(baseUrl);
  const hrefRe = /href\s*=\s*["']([^"'#]+)["']/gi;
  const keywords = /about|services|company|what-we-do|our-story|home/i;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1];
    if (!keywords.test(href)) continue;
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const abs = new URL(href, base);
      if (abs.hostname !== base.hostname) continue;
      return abs.href;
    } catch { /* ignore malformed href */ }
  }
  return null;
}
