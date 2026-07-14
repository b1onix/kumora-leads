import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, AuthError } from './api.js';

/**
 * Auth context. Resolves the current user from the session cookie on load
 * (via /auth/me), exposes login/register/logout, and gates the app: until we
 * know whether someone is logged in we show nothing; if not logged in we show
 * the AuthScreen; only an authenticated user reaches the dashboard.
 */
const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const login = async (email, password) => { const { user } = await api.login(email, password); setUser(user); };
  const register = async (email, password) => { const { user } = await api.register(email, password); setUser(user); };
  const logout = async () => { try { await api.logout(); } finally { setUser(null); } };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, reload: load }}>
      {children}
    </AuthCtx.Provider>
  );
}

/** Map-pin brand mark (surveyor's flag orange). */
export function PinMark({ size = 20 }) {
  return (
    <span className="pin-mark">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" fill="currentColor" />
        <circle cx="12" cy="9" r="2.6" fill="#13202F" />
      </svg>
    </span>
  );
}

/** Drifting topographic contours — the auth screen's ambient signature. */
function TopoLines() {
  return (
    <svg className="topo" viewBox="0 0 900 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="rgba(238,244,248,0.10)" strokeWidth="1.1">
        <path d="M50 780 C 180 700, 160 560, 300 520 S 560 560, 640 440 S 820 300, 880 320" />
        <path d="M-20 700 C 140 640, 130 500, 280 450 S 540 500, 620 380 S 800 230, 900 250" />
        <path d="M-40 620 C 110 570, 100 440, 260 390 S 520 440, 600 320 S 780 170, 920 190" />
        <path d="M-60 540 C 90 500, 80 380, 240 330 S 500 380, 580 260 S 760 110, 940 130" />
        <path d="M-30 860 C 200 770, 190 630, 330 590 S 590 630, 670 510 S 850 380, 920 400" />
        <path d="M0 940 C 230 840, 220 700, 360 660 S 620 700, 700 580 S 880 460, 950 480" />
      </g>
      <g fill="none" stroke="rgba(232,73,15,0.35)" strokeWidth="1.2" strokeDasharray="3 6">
        <path d="M-50 460 C 70 430, 60 320, 220 270 S 480 320, 560 200 S 740 60, 950 80" />
      </g>
      <g fontFamily="'IBM Plex Mono', monospace" fontSize="9" fill="rgba(238,244,248,0.22)">
        <text x="240" y="265">120</text>
        <text x="255" y="385">100</text>
        <text x="275" y="445">80</text>
        <text x="295" y="515">60</text>
      </g>
    </svg>
  );
}

/** Full-screen sign in / create account — the site's front door. */
export function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await register(email.trim(), password);
    } catch (e2) {
      setErr(e2 instanceof AuthError ? e2.message : (e2.message || 'something went wrong'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-split">
      <div className="auth-brand">
        <TopoLines />

        <div className="brand-lockup">
          <PinMark size={20} />
          Lead<b>Extractor</b>
        </div>

        <div className="auth-hero">
          <div className="coord">Field kit for cold outreach</div>
          <h1>The map is your <em>lead list.</em></h1>
          <p>
            Pull every business from a Google Maps search, let AI write one
            personal email per lead, and send from your own domain.
          </p>
        </div>

        <div className="auth-steps">
          <div className="step">
            <span className="step-num">01</span>
            <div><b>Scrape</b><span>the extension captures every business on the map</span></div>
          </div>
          <div className="step">
            <span className="step-num">02</span>
            <div><b>Draft</b><span>AI reads each website and writes one personal email</span></div>
          </div>
          <div className="step">
            <span className="step-num">03</span>
            <div><b>Send</b><span>review, approve, and send from your own domain</span></div>
          </div>
        </div>
      </div>

      <div className="auth-form">
        <div className="auth-card">
          <h2>{mode === 'login' ? 'Sign in' : 'Create your account'}</h2>
          <p className="auth-sub">
            {mode === 'login'
              ? 'Pick up where your last survey left off.'
              : 'Free to start — connect the extension after.'}
          </p>

          <form onSubmit={submit}>
            <label className="field">
              <span className="fl">Email</span>
              <input type="email" autoComplete="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </label>
            <label className="field">
              <span className="fl">Password {mode === 'register' && <span className="hint">min 8 characters</span>}</span>
              <input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required minLength={8} value={password}
                onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
            </label>

            {err && <div className="banner warn" style={{ marginBottom: 12 }}>{err}</div>}

            <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Please wait…' : (mode === 'login' ? 'Sign in' : 'Create account')}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--ink-2)' }}>
            {mode === 'login' ? (
              <>New here?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setErr(''); setMode('register'); }}>Create an account</a></>
            ) : (
              <>Already have an account?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setErr(''); setMode('login'); }}>Sign in</a></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
