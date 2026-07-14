import React, { useState, useEffect } from 'react';
import { useData } from '../App.jsx';
import { api } from '../api.js';

export default function Settings() {
  const { toast, refresh } = useData();
  const [s, setS] = useState(null);
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => { api.settings().then(setS).catch((e) => toast(e.message, 'err')); }, []);

  if (!s) return <div className="page-head"><h1>Settings</h1></div>;

  const set = (k, v) => setS((prev) => ({ ...prev, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const patch = { ...s };
      delete patch.resendApiKey; delete patch.hasResendKey;
      if (keyInput.trim()) patch.resendApiKey = keyInput.trim();
      const r = await api.saveSettings(patch);
      setKeyInput('');
      const fresh = await api.settings(); setS(fresh);
      toast(r.health?.ok ? 'Saved — you are ready to send' : 'Saved (still missing: ' + r.health.missing.join(', ') + ')');
      refresh();
    } catch (e) { toast(e.message, 'err'); }
    finally { setSaving(false); }
  }

  async function sendTest() {
    setTesting(true);
    try { const r = await api.testEmail(s.testInbox || s.fromEmail);
      toast(r.ok ? 'Test email sent — check your inbox' : 'Failed: ' + r.error, r.ok ? 'ok' : 'err');
    } catch (e) { toast(e.message, 'err'); }
    finally { setTesting(false); }
  }

  return (
    <>
      <div className="page-head">
        <div><h1>Settings</h1><p>Configure sending, your offer, and the extension connection.</p></div>
        <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : '💾 Save settings'}</button>
      </div>

      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <Section title="Resend (sending)">
            <label className="field">
              <span className="fl">Resend API key {s.hasResendKey && <span className="hint">saved: {s.resendApiKey}</span>}</span>
              <input type="password" placeholder={s.hasResendKey ? 'Enter a new key to replace' : 're_...'} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
            </label>
            <div className="row">
              <label className="field"><span className="fl">From name</span>
                <input type="text" value={s.fromName || ''} onChange={(e) => set('fromName', e.target.value)} placeholder="Armin" /></label>
              <label className="field"><span className="fl">From email <span className="hint">verified domain</span></span>
                <input type="email" value={s.fromEmail || ''} onChange={(e) => set('fromEmail', e.target.value)} placeholder="armin@yourdomain.com" /></label>
            </div>
            <label className="field"><span className="fl">Reply-to <span className="hint">where answers land</span></span>
              <input type="email" value={s.replyTo || ''} onChange={(e) => set('replyTo', e.target.value)} placeholder="you@gmail.com" /></label>
          </Section>

          <Section title="Your offer (fed to the AI writer)">
            <label className="field"><span className="fl">Company</span>
              <input type="text" value={s.senderCompany || ''} onChange={(e) => set('senderCompany', e.target.value)} placeholder="Acme Web Studio" /></label>
            <label className="field"><span className="fl">What you offer</span>
              <textarea rows={2} value={s.offer || ''} onChange={(e) => set('offer', e.target.value)} placeholder="we build fast websites for local trades that turn visitors into booked jobs" /></label>
            <label className="field"><span className="fl">Call-to-action goal</span>
              <input type="text" value={s.ctaGoal || ''} onChange={(e) => set('ctaGoal', e.target.value)} placeholder="a quick 15-minute call this week" /></label>
          </Section>
        </div>

        <div style={{ flex: 1 }}>
          <Section title="Compliance (required by law)">
            <label className="field"><span className="fl">Physical address <span className="hint">shown in every email footer</span></span>
              <input type="text" value={s.physicalAddress || ''} onChange={(e) => set('physicalAddress', e.target.value)} placeholder="Acme Web Studio, 12 High St, Denver, CO" /></label>
            <label className="field"><span className="fl">Unsubscribe email</span>
              <input type="email" value={s.unsubscribeMailto || ''} onChange={(e) => set('unsubscribeMailto', e.target.value)} placeholder="unsubscribe@yourdomain.com" /></label>
          </Section>

          <Section title="Sending safety">
            <label className="switch" style={{ marginBottom: 16 }}>
              <input type="checkbox" checked={!!s.testMode} onChange={(e) => set('testMode', e.target.checked)} />
              <span className="track" />
              <span><b>Test mode</b> <span className="muted">— route all sends to your own inbox</span></span>
            </label>
            <label className="field"><span className="fl">Test inbox</span>
              <input type="email" value={s.testInbox || ''} onChange={(e) => set('testInbox', e.target.value)} placeholder="you@gmail.com" /></label>
            <label className="field"><span className="fl">Daily send cap</span>
              <input type="number" min="1" max="100" value={s.dailyCap || 30} onChange={(e) => set('dailyCap', Number(e.target.value))} /></label>
            <button className="btn" onClick={sendTest} disabled={testing || !s.hasResendKey}>{testing ? 'Sending…' : '✉ Send test email to myself'}</button>
          </Section>

          <Section title="Extension connection">
            <ApiKeyBlock toast={toast} />
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }) {
  return (
    <div className="card pad" style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 14, color: 'var(--text)' }}>{title}</div>
      {children}
    </div>
  );
}

/**
 * Personal API key for the Chrome extension. In the normal flow the extension's
 * "Connect account" button fetches this automatically — but we show it here too
 * so it can be copied manually, and regenerated if it ever leaks (which
 * instantly disconnects any extension using the old key).
 */
function ApiKeyBlock({ toast }) {
  const [key, setKey] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.apiKey().then((r) => setKey(r.apiKey)).catch(() => setKey('')); }, []);

  const masked = key ? key.slice(0, 12) + '••••••••••••' : '';

  async function copy() {
    try { await navigator.clipboard.writeText(key); toast('API key copied'); }
    catch { toast('Copy failed — select and copy manually', 'err'); }
  }

  async function regenerate() {
    if (!window.confirm('Regenerate your API key? Any extension using the old key will stop working until you reconnect it.')) return;
    setBusy(true);
    try { const r = await api.regenerateApiKey(); setKey(r.apiKey); setRevealed(true); toast('New API key generated'); }
    catch (e) { toast(e.message, 'err'); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="note" style={{ marginTop: 0 }}>
        In the extension, click <b>Connect account</b> — it links to this account automatically.
        The key below is the manual fallback.
      </div>
      <label className="field">
        <span className="fl">Your API key</span>
        <input type="text" readOnly value={revealed ? (key || '') : masked}
          onFocus={(e) => e.target.select()} placeholder="loading…" />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn" onClick={() => setRevealed((v) => !v)} disabled={!key}>
          {revealed ? '🙈 Hide' : '👁 Reveal'}
        </button>
        <button className="btn" onClick={copy} disabled={!key}>📋 Copy</button>
        <button className="btn" onClick={regenerate} disabled={busy}>{busy ? '…' : '♻ Regenerate'}</button>
      </div>
    </>
  );
}
