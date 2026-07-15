import React from 'react';
import { TopoLines, PinMark } from '../Auth.jsx';

/**
 * Public privacy policy — served at /privacy (real path, required by the
 * Chrome Web Store) and #/privacy. No login required. The copy below states
 * what the product actually does; if behavior changes, change this page too.
 */

const EFFECTIVE = 'July 15, 2026';
const CONTACT = 'hello@kumora.io';

const SECTIONS = [
  {
    title: 'What Kumora is',
    body: (
      <>
        <p>
          Kumora is a lead-generation service made of two parts: a Chrome
          extension that captures business listings from Google Maps searches you
          run, and a dashboard at kumora.io where those leads are stored, where AI
          drafts your outreach emails, and where sending happens through your own
          email provider. This policy covers both.
        </p>
      </>
    )
  },
  {
    title: 'What we collect',
    body: (
      <>
        <p><b>Your account.</b> Email address and a password (stored only as a salted
        cryptographic hash — we cannot read it). Your plan, subscription status, and
        monthly usage counts (leads extracted, emails sent).</p>
        <p><b>Your settings.</b> Sender details you enter (name, company, offer,
        postal address for compliance footers) and, if you connect one, your Resend
        API key — stored so the service can send email from your own domain on your
        instruction. We never send from your account except when you (or an
        automation you switched on) trigger it.</p>
        <p><b>Your leads.</b> Business information the extension captures when you
        run an extraction: name, website, phone, category, address, rating, review
        count, and a contact email found on the business's own public website.
        This is information those businesses publish publicly.</p>
        <p><b>Send history.</b> A journal of outreach attempts (recipient, time,
        outcome) — kept so the service never double-emails anyone and so
        unsubscribes are honored permanently.</p>
        <p><b>Payments.</b> Handled entirely by Stripe. Card numbers never touch our
        servers; we store only your Stripe customer reference and plan status.</p>
        <p><b>Cookies.</b> One session cookie to keep you signed in. No advertising
        or cross-site tracking cookies, no analytics trackers.</p>
      </>
    )
  },
  {
    title: 'What the extension does in your browser',
    body: (
      <>
        <p>The extension runs only on Google Maps pages you open. It captures
        listing data only after you press <b>Start Extraction</b>, and it stops when
        you stop it.</p>
        <p>The extension itself talks to exactly one place: your own dashboard
        account. Because Maps doesn't show email addresses, our server — not your
        browser — visits the public websites of the businesses you pushed to your
        account and looks for a published contact address (for example on a
        contact page). These requests fetch public pages only.</p>
        <p>Captured leads stay in your browser until you push them to your
        dashboard account or export them yourself. The extension stores your
        account API key locally so it knows which account is yours. It does not
        read your browsing history, other tabs, or anything outside the Maps pages
        you actively use it on.</p>
      </>
    )
  },
  {
    title: 'How we use your data',
    body: (
      <>
        <p>To run the service you signed up for — storing your leads, drafting your
        emails, sending on your instruction, enforcing plan quotas, processing
        subscription payments, and answering support requests. Nothing else.</p>
        <p><b>We do not sell your data.</b> We do not use your leads or emails to
        train models, build shared databases, or market to anyone.</p>
      </>
    )
  },
  {
    title: 'Who processes data on our behalf',
    body: (
      <>
        <p>Four processors, each doing one job:</p>
        <p><b>DeepSeek</b> — when the dashboard drafts an email, the lead's business
        details and a short excerpt of its public website are sent to our AI
        provider to generate the text. <b>Stripe</b> — subscription payments.{' '}
        <b>Resend</b> — email delivery, through your own Resend account and API
        key. <b>Our hosting provider</b> — runs the server that stores your
        account data.</p>
        <p>No other third parties receive your data.</p>
      </>
    )
  },
  {
    title: 'Retention and deletion',
    body: (
      <>
        <p>Your data is kept while your account is active. Delete leads any time
        from the dashboard. To delete your whole account and its data, email us at{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a> from your account address —
        we remove it within 30 days.</p>
        <p>One exception: suppression records (addresses that unsubscribed or
        bounced) are kept even after deletion requests, because honoring an
        unsubscribe forever is itself a legal obligation.</p>
      </>
    )
  },
  {
    title: 'Security',
    body: (
      <>
        <p>All traffic runs over HTTPS. Passwords are hashed with scrypt and a
        per-user salt. Sessions are server-side and revocable. Every account's
        data is isolated by account ID at the database layer. API keys can be
        regenerated at any time from Settings, which immediately invalidates the
        old one.</p>
      </>
    )
  },
  {
    title: 'Your rights',
    body: (
      <>
        <p>You can access, correct, export, or delete your data. Most of it is
        directly visible and editable in the dashboard; for anything else, email{' '}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. If you're in the EU/EEA or UK,
        these include your GDPR rights (access, rectification, erasure,
        portability, objection); if you're in California, your CCPA rights.
        We respond to all requests within 30 days.</p>
      </>
    )
  },
  {
    title: 'Your responsibilities as a sender',
    body: (
      <>
        <p>You are the sender of the emails you send with this tool. The service
        enforces guardrails — compliance footers with your postal address,
        unsubscribe handling, suppression lists, and send caps — but complying with
        the laws that apply to your outreach (such as CAN-SPAM, GDPR, or PECR) is
        your responsibility.</p>
      </>
    )
  },
  {
    title: 'Changes to this policy',
    body: (
      <>
        <p>If this policy changes materially, we'll note it here with a new
        effective date and, for significant changes, email account holders.
        Questions? <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
      </>
    )
  }
];

export default function Privacy() {
  return (
    <div className="legal">
      <header className="legal-hero">
        <TopoLines />
        <div className="legal-hero-inner">
          <a className="brand-lockup" href="/">
            <PinMark size={20} />
            <b>Kumora</b>
          </a>
          <div className="coord">Legal · Effective {EFFECTIVE}</div>
          <h1>Privacy policy</h1>
          <p>
            Plain answers about what we collect, why, and what we'll never do
            with it.
          </p>
        </div>
      </header>

      <main className="legal-body">
        {SECTIONS.map((s, i) => (
          <section key={s.title} className="legal-card card">
            <div className="legal-num">{String(i + 1).padStart(2, '0')}</div>
            <div>
              <h2>{s.title}</h2>
              {s.body}
            </div>
          </section>
        ))}

        <footer className="legal-foot">
          <span>© {new Date().getFullYear()} Kumora · kumora.io</span>
          <a href="/">Back to the app</a>
        </footer>
      </main>
    </div>
  );
}
