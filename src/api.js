// Thin fetch wrapper. Auth is now a first-party session COOKIE (set httpOnly by
// the server on login/register), so requests just need credentials:'include' —
// no token to store or attach. A 401 means "not logged in" and is surfaced so
// the app shell can show the login screen.
import { useState, useEffect, useRef, useCallback } from 'react';

export class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError'; }
}

async function req(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch('/api' + path, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (res.status === 401) throw new AuthError(data.error || 'not authenticated');
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const api = {
  // auth
  me: () => req('GET', '/auth/me'),
  login: (email, password) => req('POST', '/auth/login', { email, password }),
  register: (email, password) => req('POST', '/auth/register', { email, password }),
  logout: () => req('POST', '/auth/logout'),
  // account
  apiKey: () => req('GET', '/account/apikey'),
  regenerateApiKey: () => req('POST', '/account/apikey/regenerate'),
  // billing
  billing: () => req('GET', '/billing'),
  checkout: (plan) => req('POST', '/billing/checkout', { plan }),
  // data
  state: () => req('GET', '/state'),
  writers: () => req('GET', '/writers'),
  settings: () => req('GET', '/settings'),
  saveSettings: (patch) => req('POST', '/settings', patch),
  testEmail: (to) => req('POST', '/test-email', { to }),
  import: (payload) => req('POST', '/import', payload),
  generate: (ids, auto) => req('POST', '/generate', { ids, auto }),
  approve: (ids) => req('POST', '/approve', { ids }),
  reject: (ids) => req('POST', '/reject', { ids }),
  stop: () => req('POST', '/stop'),
  suppress: (email) => req('POST', '/suppress', { email }),
  editLead: (id, patch) => req('PATCH', '/leads/' + id, patch),
  deleteLeads: (ids) => req('POST', '/leads/delete', { ids })
};

/** Poll /state every `ms`. Returns { state, error, refresh }. */
export function usePolling(ms = 1500) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.state();
      setState(s);
      setError(null);
    } catch (err) {
      setError(err.message);
      // Stop polling once the session is gone; the shell will show login.
      if (err instanceof AuthError && timer.current) clearInterval(timer.current);
    }
  }, []);

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, ms);
    return () => clearInterval(timer.current);
  }, [refresh, ms]);

  return { state, error, refresh };
}
