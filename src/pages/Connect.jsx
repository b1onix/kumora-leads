import React, { useState } from 'react';
import { useAuth, AuthScreen } from '../Auth.jsx';

/**
 * Extension connect handshake page (route: #/connect).
 *
 * The extension opens this via chrome.identity.launchWebAuthFlow, passing
 * redirect_uri (its chrome-extension callback) and state in the query string.
 * Flow:
 *   1. If not logged in → show the normal AuthScreen (login/register).
 *   2. Once logged in → show an Authorize screen naming the account.
 *   3. On Authorize → POST /connect/authorize; the server returns a redirect
 *      URL carrying the API key in the fragment. We navigate there; Chrome's
 *      launchWebAuthFlow intercepts the chromiumapp.org callback and hands the
 *      key to the extension. No copy/paste.
 */
export default function Connect() {
  const { user, loading, logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const params = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const redirectUri = params.get('redirect_uri') || '';
  const state = params.get('state') || '';
  const validTarget = /^https:\/\/[a-p]{32}\.chromiumapp\.org\//.test(redirectUri);

  if (loading) return <div className="auth-wrap"><div className="muted">Loading…</div></div>;
  if (!user) {
    return (
      <div>
        <div className="connect-banner">Connecting the LeadExtractor extension — sign in to authorize.</div>
        <AuthScreen />
      </div>
    );
  }

  async function authorize() {
    setErr(''); setBusy(true);
    try {
      const { redirect } = await postAuthorize(redirectUri, state);
      window.location.href = redirect; // Chrome intercepts the chromiumapp.org callback
    } catch (e) {
      setErr(e.message || 'authorization failed');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <span className="pin">◉</span> Lead<b>Extractor</b>
        </div>
        <h2 style={{ textAlign: 'center', margin: '4px 0' }}>Connect extension</h2>

        {!validTarget ? (
          <div className="banner warn">
            This page is opened by the browser extension. Open it from the extension's
            <b> Connect account</b> button rather than directly.
          </div>
        ) : (
          <>
            <p className="muted" style={{ textAlign: 'center' }}>
              Allow the LeadExtractor Chrome extension to push scraped leads into your account:
            </p>
            <div className="card pad" style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 800 }}>{user.email}</div>
              <div className="muted" style={{ fontSize: 12 }}>plan: {user.plan}</div>
            </div>
            {err && <div className="banner warn" style={{ marginBottom: 12 }}>{err}</div>}
            <button className="btn primary" style={{ width: '100%' }} onClick={authorize} disabled={busy}>
              {busy ? 'Authorizing…' : 'Authorize extension'}
            </button>
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
          Not you? <a href="#" onClick={(e) => { e.preventDefault(); logout(); }}>Switch account</a>
        </div>
      </div>
    </div>
  );
}

// api.js doesn't expose a generic request(); do the fetch inline so we stay
// consistent with its credentials:'include' behaviour.
async function postAuthorize(redirectUri, state) {
  const res = await fetch('/api/connect/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ redirectUri, state })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
