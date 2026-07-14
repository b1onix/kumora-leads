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

/** Full-screen login / register form shown when no session is active. */
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
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 8 }}>
          <span className="pin">◉</span> Lead<b>Extractor</b>
        </div>
        <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>
          {mode === 'login' ? 'Sign in to your account' : 'Create your account'}
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

          <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Please wait…' : (mode === 'login' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>
          {mode === 'login' ? (
            <>No account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setErr(''); setMode('register'); }}>Create one</a></>
          ) : (
            <>Already have an account?{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setErr(''); setMode('login'); }}>Sign in</a></>
          )}
        </div>
      </div>
    </div>
  );
}
