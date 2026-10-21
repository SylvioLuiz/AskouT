import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api, session, setUnauthorizedHandler } from './api.ts';
import { useDesktop } from './hooks.ts';
import { MIN_DESKTOP_WIDTH } from './labels.ts';
import { AuditPage } from './pages/audit.tsx';
import { ClaimsPage } from './pages/claims.tsx';
import { DashboardPage } from './pages/dashboard.tsx';
import { EventsPage } from './pages/events.tsx';
import { PostsPage } from './pages/posts.tsx';
import { PaymentsPage } from './pages/payments.tsx';
import { RetentionPage } from './pages/retention.tsx';
import { ReportsPage } from './pages/reports.tsx';
import { UsersPage } from './pages/users.tsx';
import { VenuesPage } from './pages/venues.tsx';
import { CHANGED_EVENT } from './ui.tsx';
import { go, useRoute } from './router.ts';
import { ROUTES } from './routes.ts';
import type { RoutePath } from './routes.ts';
import type { SessionUser } from './types.ts';

type Admin = SessionUser;

function LoginScreen({ onLogin, expired }: { onLogin: (u: Admin) => void; expired: boolean }) {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const idId = useId();
  const pwId = useId();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.login(identifier.trim(), password);
      if (result.user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN', 'Acesso restrito a administradores');
      session.set(result.token);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Algo deu errado. Tente de novo.');
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <h1>AskouT Gestão</h1>
        <p className="muted">Acesso restrito a administradores.</p>
        {expired ? <p className="notice">Sua sessão acabou. Entre de novo.</p> : null}
        <div className="field">
          <label htmlFor={idId}>E-mail ou @usuário</label>
          <input id={idId} value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoFocus required />
        </div>
        <div className="field">
          <label htmlFor={pwId}>Senha</label>
          <input id={pwId} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        {error ? (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn--primary btn--block" disabled={busy || identifier.trim() === '' || password === ''}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  );
}

function Page({ route }: { route: RoutePath }) {
  switch (route) {
    case '/pedidos':
      return <ClaimsPage />;
    case '/denuncias':
      return <ReportsPage />;
    case '/pessoas':
      return <UsersPage />;
    case '/locais':
      return <VenuesPage />;
    case '/eventos':
      return <EventsPage />;
    case '/posts':
      return <PostsPage />;
    case '/retencao':
      return <RetentionPage />;
    case '/pagamentos':
      return <PaymentsPage />;
    case '/auditoria':
      return <AuditPage />;
    default:
      return <DashboardPage />;
  }
}

function Shell({ admin, onLogout }: { admin: Admin; onLogout: () => void }) {
  const route = useRoute();
  const [pending, setPending] = useState<{ claims: number; reports: number }>({ claims: 0, reports: 0 });

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.stats().then(
        (s) => alive && setPending({ claims: s.pendingClaims, reports: s.openPostReports + s.openConversationReports + (s.openStoryReports ?? 0) }),
        () => {},
      );
    void load();
    const t = setInterval(load, 60_000);
    const onChanged = () => void load();
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(CHANGED_EVENT, onChanged);
    };
  }, [route]);

  const badge = (path: RoutePath) => (path === '/pedidos' ? pending.claims : path === '/denuncias' ? pending.reports : 0);

  return (
    <div className="shell">
      <aside className="side">
        <div className="side__brand">AskouT Gestão</div>
        <nav aria-label="Seções">
          {ROUTES.map((r) => (
            <a
              key={r.path}
              href={r.path}
              className={r.path === route ? 'nav nav--on' : 'nav'}
              aria-current={r.path === route ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                go(r.path);
              }}
            >
              <span>{r.label}</span>
              {badge(r.path) > 0 ? <span className="nav__count">{badge(r.path)}</span> : null}
            </a>
          ))}
        </nav>
        <div className="side__me">
          <div>
            <strong>{admin.profile.displayName}</strong>
            <div className="muted small">@{admin.profile.username}</div>
          </div>
          <button type="button" className="btn btn--small" onClick={onLogout}>
            Sair
          </button>
        </div>
      </aside>
      <main className="main">
        <Page route={route} />
      </main>
    </div>
  );
}

export function App() {
  const desktop = useDesktop(MIN_DESKTOP_WIDTH);
  const [admin, setAdmin] = useState<Admin>();
  const [checking, setChecking] = useState(() => session.get() !== undefined);
  const [expired, setExpired] = useState(false);

  const logout = useCallback(() => {
    session.clear();
    setAdmin(undefined);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      session.clear();
      setAdmin(undefined);
      setExpired(true);
    });
  }, []);

  // Sessão guardada na aba: confirma que ainda vale e que a conta continua sendo de admin.
  useEffect(() => {
    if (session.get() === undefined) return;
    let alive = true;
    api.me().then(
      (me) => {
        if (!alive) return;
        if (me.role === 'ADMIN') setAdmin(me);
        else session.clear();
        setChecking(false);
      },
      () => {
        if (!alive) return;
        session.clear();
        setChecking(false);
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  if (!desktop) {
    return (
      <main className="desktop-only">
        <h1>Acesso apenas pelo computador</h1>
        <p>A gestão do AskouT foi feita para telas grandes. Abra este endereço em um computador (janela com pelo menos {MIN_DESKTOP_WIDTH} px de largura).</p>
      </main>
    );
  }
  if (checking) return <div className="state muted">Carregando…</div>;
  if (!admin) return <LoginScreen onLogin={(u) => { setExpired(false); setAdmin(u); }} expired={expired} />;
  return <Shell admin={admin} onLogout={logout} />;
}
