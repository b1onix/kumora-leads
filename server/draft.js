import { runLLM } from './llm.js';
import { fetchWebsiteSnippet } from './website.js';
import { writerStyle } from './writers.js';

/**
 * Builds the cold-email prompt for one lead, runs the model, and parses the
 * returned draft. Rules baked in follow current cold-outreach research:
 * 50-125 words, short lowercase subject, specific personalized first line,
 * one soft CTA, plain text. The compliance footer is added at SEND time by
 * mailer.js — the model never owns legal text.
 *
 * Generation runs on the DeepSeek API (server/llm.js), which cannot browse.
 * So when the lead has a website we fetch a text snippet from it beforehand
 * (server/website.js) and pass it in via `websiteSnippet` for the model to
 * personalize from.
 */

export function buildPrompt(lead, settings, websiteSnippet = null) {
  const leadInfo = {
    business: lead.name,
    category: lead.category || null,
    address: lead.address || null,
    website: lead.website || null,
    rating: lead.rating || null,
    reviews: lead.reviews || null
  };

  let research;
  if (websiteSnippet) {
    research = `RESEARCH:
Here is text pulled from the lead's website (${lead.website}). Use it to find ONE specific, non-generic detail to personalize with — a service they highlight, their service area, years in business, or a recurring theme in how they present themselves:
"""
${websiteSnippet}
"""
Only reference things that actually appear above or in the lead data. Never invent facts.`;
  } else if (lead.website) {
    research = `RESEARCH:
The lead has a website (${lead.website}) but its text could not be retrieved. Personalize from the category, location, and rating/review count instead. Never invent facts.`;
  } else {
    research = `RESEARCH:
This lead has no website. Personalize from the category, location, and rating/review count. Never invent facts.`;
  }

  // Pro/Ultra accounts can shape the writer with their own instructions.
  // engine.js clears this field for plans that don't include it, so its
  // presence here means the plan allows it. Style-level only — the output
  // contract and compliance rules below still win on any conflict.
  const custom = String(settings.aiInstructions || '').trim();
  const customBlock = custom
    ? `\nCUSTOM STYLE INSTRUCTIONS FROM THE SENDER (follow them unless they conflict with the writing rules or output format below):\n${custom.slice(0, 2000)}\n`
    : '';

  return `You are an expert cold-email copywriter. Write ONE personalized cold outreach email to the business described below.

<sender>
Name: ${settings.fromName || 'the sender'}
Company: ${settings.senderCompany || '-'}
What they offer: ${settings.offer || '(no offer configured — write a generic friendly intro)'}
Goal of the email: ${settings.ctaGoal || 'a quick call'}
</sender>

<lead>
${JSON.stringify(leadInfo, null, 2)}
</lead>

${research}
${writerStyle(settings.writerStyle)}
${customBlock}
HARD RULES (these always win over the voice above):
- Never exceed 125 words total; if the voice sets a tighter budget, honor it.
- Subject: 2-7 words, specific, no clickbait, no brackets, no spam words (free, guarantee, act now). Lowercase unless the voice explicitly allows sentence case.
- The FIRST LINE must reference the specific detail you found. Banned openers: "I hope this email finds you well", "I came across your website", "My name is".
- Connect their situation to the sender's offer. Outcomes, not features.
- Exactly ONE soft, low-friction CTA phrased as a question. Never ask for a 30-minute meeting.
- No bullet points, no placeholders like [Name], no emojis, no links in the body.
- Sign off with just the sender's first name.
- Do NOT include any unsubscribe or legal text (it is appended automatically later).

OUTPUT:
Your ENTIRE final message must be exactly one raw JSON object — no markdown fences, no commentary before or after:
{"subject": "...", "body": "...", "research_note": "one line describing the specific detail you personalized with"}`;
}

/** Tolerant extraction of the {subject, body, research_note} object. */
export function parseDraft(text) {
  if (!text || typeof text !== 'string') return { error: 'empty response' };

  let t = text.trim();
  // Strip accidental markdown fences.
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // Slice from the first { to the last }.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return { error: 'no JSON object in response' };

  let obj;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch (err) {
    return { error: 'invalid JSON: ' + err.message };
  }

  const subject = String(obj.subject || '').trim();
  const body = String(obj.body || '').trim();
  if (subject.length < 2 || subject.length > 80) return { error: `bad subject length (${subject.length})` };
  if (body.length < 40) return { error: 'body too short' };
  if (/\[(name|company|business)\]/i.test(body)) return { error: 'body contains placeholders' };

  return {
    subject,
    body,
    researchNote: String(obj.research_note || '').trim()
  };
}

/**
 * Generate a draft for one lead. Retries once with the parse error appended.
 * Returns { ok, draft?, error?, cost? }.
 *
 * Because DeepSeek can't browse, we fetch the website snippet once up front and
 * reuse it across both attempts (no point re-fetching the site on a retry that
 * only failed JSON validation).
 */
export async function generateDraft(lead, settings) {
  let websiteSnippet = null;
  if (lead.website) {
    try {
      websiteSnippet = await fetchWebsiteSnippet(lead.website);
    } catch {
      websiteSnippet = null; // best-effort — fall back to Maps data
    }
  }

  let prompt = buildPrompt(lead, settings, websiteSnippet);
  let lastError = null;
  let totalCost = 0;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const run = await runLLM(prompt);
    if (!run.ok) {
      lastError = run.error;
      // Infra errors (timeout, auth, no balance) won't improve by re-prompting,
      // but one retry is still worthwhile for transient failures.
      continue;
    }
    if (run.cost) totalCost += run.cost;
    const parsed = parseDraft(run.result);
    if (!parsed.error) {
      return {
        ok: true,
        draft: {
          subject: parsed.subject,
          body: parsed.body,
          researchNote: parsed.researchNote,
          generatedAt: new Date().toISOString(),
          editedByUser: false
        },
        cost: totalCost || run.cost
      };
    }
    lastError = parsed.error;
    prompt += `\n\nYour previous reply failed validation: ${parsed.error}. Reply again with ONLY the raw JSON object.`;
  }

  return { ok: false, error: lastError || 'generation failed' };
}
