import React, { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { usePolling } from './api.js';
import { useAuth, AuthScreen, PinMark } from './Auth.jsx';
import { IconCompass, IconPins, IconQuill, IconPlane, IconSliders, IconTag } from './Icons.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Leads from './pages/Leads.jsx';
import Compose from './pages/Compose.jsx';
import Review from './pages/Review.jsx';
import Settings from './pages/Settings.jsx';
import Billing from './pages/Billing.jsx';
import Connect from './pages/Connect.jsx';

// Tiny hash-based router (no dependency).
const ROUTES = {
  '/': { label: 'Dashboard', icon: IconCompass, comp: Dashboard },
  '/leads': { label: 'Leads', icon: IconPins, comp: Leads },
  '/compose': { label: 'Generate', icon: IconQuill, comp: Compose },
  '/review': { label: 'Review & Send', icon: IconPlane, comp: Review },
  '/billing': { label: 'Plan & Billing', icon: IconTag, comp: Billing },
  '/settings': { label: 'Settings', icon: IconSliders, comp: Settings }
};

function useHash() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || '/');
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || '/');
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

// ---- toast context ----
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

function ToastHost({ toasts }) {
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={'toast' + (t.kind === 'err' ? ' err' : '')}>{t.msg}</div>
      ))}
    </div>
  );
}

// ---- app-wide data context (single poll shared by all pages) ----
const DataCtx = createContext(null);
export const useData = () => useContext(DataCtx);

/** Sidebar plan chip + monthly usage meters (leads extracted / emails sent). */
function PlanMeters({ usage }) {
  const meter = (label, m) => {
    const pct = m.limit ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
    const near = m.limit && pct >= 85;
    return (
      <div className="meter">
        <div className="meter-top">
          <span>{label}</span>
          <span>{m.used.toLocaleString()} / {m.limit ? m.limit.toLocaleString() : '∞'}</span>
        </div>
        <div className="meter-track">
          <div className={'meter-fill' + (near ? ' near' : '')} style={{ width: (m.limit ? pct : 4) + '%' }} />
        </div>
      </div>
    );
  };
  return (
    <div className="plan-box">
      <a className={'plan-chip ' + usage.plan} href="#/billing">{usage.planLabel} plan</a>
      {meter('Leads', usage.leads)}
      {meter('Emails', usage.emails)}
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const hash = useHash();

  // The /connect route is the extension authorize handshake. It must be
  // reachable whether or not you're already logged in (it shows login inside
  // itself if needed), and it renders outside the dashboard shell.
  if (hash === '/connect' || hash.startsWith('/connect')) return <Connect />;

  if (loading) {
    return <div className="auth-wrap"><div className="muted">Loading…</div></div>;
  }
  if (!user) return <AuthScreen />;

  return <Shell />;
}

function Shell() {
  const { user, logout } = useAuth();
  const hash = useHash();
  const route = ROUTES[hash] || ROUTES['/'];
  const Comp = route.comp;
  const { state, error, refresh } = usePolling(1500);
  const [toasts, setToasts] = useState([]);

  const toast = useCallback((msg, kind = 'ok') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const leads = state?.leads || [];
  const counts = {
    total: leads.length,
    withEmail: leads.filter((l) => l.email).length,
    drafted: leads.filter((l) => ['drafted', 'approved', 'sending'].includes(l.status)).length,
    needReview: leads.filter((l) => l.status === 'drafted').length,
    sent: leads.filter((l) => l.status === 'sent').length
  };

  const connected = !error && state != null;

  return (
    <ToastCtx.Provider value={toast}>
      <DataCtx.Provider value={{ state, refresh, toast, counts }}>
        <div className="app">
          <aside className="sidebar">
            <div className="brand"><span className="pin"><PinMark size={17} /></span> Lead<b>Extractor</b></div>
            <nav className="nav">
              {Object.entries(ROUTES).map(([path, r]) => {
                const active = hash === path;
                const Icon = r.icon;
                let badge = null;
                if (path === '/leads' && counts.total) badge = counts.total;
                if (path === '/review' && counts.needReview) badge = counts.needReview;
                return (
                  <a key={path} href={'#' + path} className={active ? 'active' : ''}>
                    <span className="ico"><Icon /></span>
                    {r.label}
                    {badge != null && <span className="badge">{badge}</span>}
                  </a>
                );
              })}
            </nav>
            <div className="sidebar-foot">
              {state?.usage && <PlanMeters usage={state.usage} />}
              <div className="conn">
                <span className={'dot ' + (connected ? 'on' : 'off')} />
                {connected ? 'Connected' : 'Offline'}
              </div>
              {state?.engine?.generating && <div>drafting · {state.engine.genRemaining} queued</div>}
              {state?.engine?.sending && <div>sending…</div>}
              <div className="user-row">
                <span className="user-email" title={user?.email}>{user?.email}</span>
                <button className="link-btn" onClick={logout}>Log out</button>
              </div>
            </div>
          </aside>

          <main className="main">
            {error && (
              <div className="banner warn">
                Can't reach the server ({error}). Check your connection and refresh.
              </div>
            )}
            <Comp />
          </main>
        </div>
        <ToastHost toasts={toasts} />
      </DataCtx.Provider>
    </ToastCtx.Provider>
  );
}

export { ROUTES };
