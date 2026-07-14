# LeadExtractor Outreach Dashboard

A local web app that turns the leads you scrape with the LeadExtractor Chrome
extension into a cold-email outreach pipeline:

**Import leads → Claude writes a personalized email for each → you review → Resend sends them.**

- **One-click import** from the extension (`⇪ Send to Dashboard`), or drag-drop a JSON file.
- **AI drafting** uses your installed **Claude Code CLI** — Claude visits each
  business's website, finds something specific, and writes a short personalized
  cold email. No API key, no per-token cost; it uses your Claude subscription.
- **Two run modes**: *Manual* (review & approve every email) or *Auto*
  (generate + send automatically, respecting a daily cap).
- **Resend** does the actual sending from your verified domain, with a
  compliance footer (physical address + unsubscribe) added automatically.
- **Safety**: test mode (routes to your own inbox), daily send cap, suppression
  list, and a journal that prevents double-sending.

Everything runs on your machine (`127.0.0.1`). Nothing is uploaded anywhere
except the emails you explicitly send through Resend.

---

## Prerequisites

- **Node.js 18+** (you have 22 ✓)
- **Claude Code CLI** installed and logged in — test with `claude --version`
  in a terminal. If it prints a version, you're set.
- A **Resend account** with a **verified domain** and an **API key**
  (https://resend.com/api-keys).

## Setup (one time)

```bash
cd dashboard
npm install
npm run setup       # creates .env and a random import token
```

`npm run setup` prints an **import token** — copy it, you'll paste it into the
extension the first time you push leads (and into Settings → Extension
connection in the web UI).

Then either edit `dashboard/.env` with your Resend details, or just fill them
in later on the **Settings** page in the browser. Minimum to send:
`RESEND_API_KEY`, `FROM_EMAIL` (on your verified domain), `FROM_NAME`,
`PHYSICAL_ADDRESS`.

## Run

```bash
npm run dev
```

- API server → http://127.0.0.1:4820
- Web UI    → **http://localhost:5173**  ← open this

(For a single-process production-style run: `npm run build` then `npm start`,
and open http://127.0.0.1:4820.)

---

## How to use it

1. **Scrape** a Google Maps search with the extension (e.g. "HVAC Colorado").
   Make sure **Email** is one of the selected fields so emails get hunted.
2. In the extension panel, click **⇪ Send to Dashboard**. First time, paste the
   import token. Leads appear on the dashboard's **Leads** page.
   - No server running? Click **⬇ JSON** instead and drag the file onto the
     Leads page.
3. Go to **Generate**. Pick **Manual** or **Auto**, then draft.
   - Claude researches each site and writes the email (a few seconds each,
     2 at a time).
4. **Manual mode** → go to **Review & Send**, edit anything, then approve
   (individually or all at once).
   **Auto mode** → drafts are approved and sent automatically as they finish.
5. Watch statuses flip to **sent**. Replies go to your Reply-To inbox.

**Tip:** keep **Test mode** ON (Settings) until you've sent yourself a test and
are happy with the emails. Then turn it off to send to real businesses.

---

## How it works (architecture)

```
Extension  ──POST /api/import──►  Express API (127.0.0.1:4820)
                                    │
                                    ├─ store.js     JSON DB (data/db.json)
                                    ├─ engine.js    per-lead state machine + queues
                                    ├─ claude.js    spawns `claude -p` (your CLI)
                                    ├─ draft.js     prompt + parse the email JSON
                                    ├─ mailer.js    Resend send + guards + footer
                                    └─ journal.js   append-only sends.jsonl (idempotency)
React UI (Vite) ◄──poll /api/state──┘
```

Lead lifecycle:
`imported → ready → generating → drafted → approved → sending → sent`
(plus `no_email`, `draft_failed`, `send_failed`, `rejected`, `suppressed`).

Both run modes go through the **same** state machine — auto mode just
auto-approves drafts. Send guards (suppression, daily cap, "already sent"
journal, test-mode redirect) are enforced at the send step, so they protect
both modes.

## Cold-email notes

The email prompt follows current best practice: 50–125 words, short lowercase
subject, a first line referencing something specific about *their* business,
one soft CTA, plain text. Compliance footer (postal address + unsubscribe) is
added at send time — legally required for cold email (CAN-SPAM). You are
responsible for sending volume, consent, and local laws (e.g. GDPR for EU
businesses). Keep volumes sane; the app defaults to a 30/day cap and spaces
sends out to protect your domain reputation.

## Troubleshooting

- **"claude not authenticated"** on generation → run `claude` once in a normal
  terminal to log in, then retry.
- **Extension push fails** → make sure `npm run dev` is running and the import
  token matches; otherwise use the **⬇ JSON** fallback.
- **Emails not sending** → check Settings has a valid Resend key + a From email
  on your verified domain; try "Send test email to myself".
- **Port 4820 in use** → change `PORT` in `dashboard/.env`.
