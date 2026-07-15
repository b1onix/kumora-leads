/**
 * Writer agents — six distinct voices for the AI email writer.
 *
 * Each agent is a curated style block injected into the drafting prompt
 * (draft.js). The hard rules — word budget, single soft CTA, no placeholders,
 * compliance footer added at send time, JSON output — always apply and always
 * win over style. The agent shapes voice, structure, subject style, first-line
 * strategy, and CTA phrasing.
 *
 * Grounded in current outreach research (2026):
 *  - 20–80 words beats long copy; one unambiguous soft ask.
 *  - Situational first lines beat compliments ("personalization theater").
 *  - PAS (problem→agitate→solve) wins on first touch for pain-aware niches.
 *  - "Diagnose, don't pitch" for local businesses: ~80% their world, 20% you.
 *  - Self-aware pattern interrupts cut through inbox pattern-recognition.
 */

export const WRITERS = {
  friendly: {
    label: 'Friendly Neighbor',
    tagline: 'Warm and human — reads like a note from someone nearby, not a pitch.',
    style: `VOICE — "Friendly Neighbor":
Write like a real person dashing off a short, warm note — a fellow human who
happens to do useful work, not a company addressing a lead. Contractions,
plain words, one light touch of warmth (never gushing).
- First line: a specific, situational observation about THEIR business, said
  the way you'd mention it to them in person.
- Keep it 50-80 words. Short sentences. No sales vocabulary at all
  ("solutions", "leverage", "boost" are banned).
- Subject: lowercase, feels like a note from an acquaintance ("quick thought
  about your booking page").
- CTA: gentle and zero-pressure ("open to a quick chat sometime?").`
  },

  professional: {
    label: 'Straight Professional',
    tagline: 'Crisp, respectful, credible — for law, medical, finance and formal niches.',
    style: `VOICE — "Straight Professional":
Write like a competent consultant addressing a busy practice owner: courteous,
precise, zero slang, zero exclamation marks. Credibility through specificity,
not adjectives.
- First line: a precise, professional observation about their practice or
  market position — the kind a well-prepared advisor would open with.
- Structure: observation → the concrete business implication → one sentence on
  how the sender addresses it → respectful ask. 60-100 words.
- Subject: sentence case allowed here (the one voice where it fits), specific
  and unhyped (e.g. for a dental clinic: "A note on patient intake").
- CTA: respectful of their time ("Would a brief call next week be
  unreasonable?").
- Never use humor, emoji-adjacent phrasing, or familiarity.`
  },

  trendy: {
    label: 'Pattern Break',
    tagline: 'Self-aware and disarming — breaks the cold-email pattern people auto-delete.',
    style: `VOICE — "Pattern Break":
The reader gets 50 pitches a day and their brain auto-deletes anything that
smells like one. Break the pattern: be disarmingly honest, a little playful,
and radically brief. Self-awareness is the tool ("yes, this is a cold email —
it'll cost you 20 seconds").
- First line: either an unexpected, honest admission OR a sharp specific
  observation phrased in a way no template would phrase it.
- 35-70 words. Punchy lines. It's fine to break one sentence into two. For.
  Effect. (Sparingly.)
- Subject: 2-4 lowercase words, curiosity without clickbait ("this one's
  actually short").
- CTA: casual and binary-easy ("worth a reply? even a 'no' helps").
- The line between charming and cringe is thin: NO memes, no forced slang, no
  jokes about their business. The humor is in the honesty, not in gags.`
  },

  consultant: {
    label: 'Problem Solver',
    tagline: 'Diagnose, don’t pitch — leads with a specific problem you noticed.',
    style: `VOICE — "Problem Solver":
Follow problem → agitate → solve. Spend ~80% of the words in THEIR world and
~20% on the sender. You noticed something specific and expensive; you're
pointing it out like a good consultant would, free of charge.
- First line: name the specific problem or gap you observed (from their
  website/data) — concrete, not generic ("your booking form takes 4 taps to
  reach on mobile", not "your online presence could improve").
- Then ONE sentence on what that likely costs them (missed calls, lost
  bookings, invisible to searchers). No fear-mongering — matter-of-fact.
- Then ONE sentence on how the sender fixes exactly that.
- 60-100 words. Subject: names the problem area, lowercase ("the contact form
  on your site").
- CTA: an easy diagnostic offer ("want me to send over what I noticed?").`
  },

  local: {
    label: 'Local Peer',
    tagline: 'Community angle — one local business person writing to another.',
    style: `VOICE — "Local Peer":
Write as someone who knows their area — a peer in the local business
community, not an outsider blasting a list. The city/neighborhood from the
lead data is your anchor; use it naturally, once or twice, never as a gimmick.
- First line: root it in their local reality (their part of town, what
  customers around there search for, how they stack up among nearby
  competitors — use the rating/review data if it helps).
- Tone: neighborly, respectful of how hard running a local business is. A
  small nod to that reality lands well ("I know Saturdays are your busiest").
- 50-90 words. Subject: lowercase with the place in it (e.g. "your shop in
  cherry creek" — use their actual area from the lead data).
- CTA: low-key and local-feeling ("happy to swing by or hop on a quick
  call — whichever's easier").`
  },

  direct: {
    label: 'Straight Shooter',
    tagline: 'Ultra-short and transparent — respects the reader’s time above all.',
    style: `VOICE — "Straight Shooter":
The entire strategy is respect for their time. 35-60 words TOTAL — the
shortest email in their inbox today. No warm-up, no filler, no adjectives
that don't earn their place.
- Structure, in exactly this order: one specific observed fact about them →
  one sentence on what the sender does about it → the ask. Three to five
  sentences, done.
- Subject: 2-3 lowercase words, plain ("your missed calls").
- CTA: binary and effortless ("interested? a one-word reply is fine").
- Absolutely no "I hope", no "just", no "I wanted to reach out", no throat-
  clearing of any kind. Every word carries weight or gets cut.`
  }
};

export const DEFAULT_WRITER = 'friendly';

export function getWriter(key) {
  return WRITERS[key] ? key : DEFAULT_WRITER;
}

export function writerStyle(key) {
  return WRITERS[getWriter(key)].style;
}

/** Catalog for the UI picker. */
export function writerList() {
  return Object.entries(WRITERS).map(([key, w]) => ({
    key,
    label: w.label,
    tagline: w.tagline
  }));
}
