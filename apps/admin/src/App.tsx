import { useCallback, useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, api, session, setUnauthorizedHandler } from './api.ts';
import { APPLE_BUTTON_URL, appleIdToken } from './apple-login.ts';
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
import { CHANGED_EVENT, Modal } from './ui.tsx';
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
  const [appleClientId, setAppleClientId] = useState<string>();
  const [appleImageFailed, setAppleImageFailed] = useState(false);
  const idId = useId();
  const pwId = useId();

  // Sem APPLE_CLIENT_ID na API (ou se a consulta falhar), o botão simplesmente não aparece.
  useEffect(() => {
    let cancelled = false;
    api.socialProviders()
      .then((r) => {
        if (!cancelled) setAppleClientId(r.items.find((p) => p.provider === 'APPLE')?.clientId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function withApple() {
    if (busy || !appleClientId) return;
    setBusy(true);
    setError(undefined);
    try {
      const idToken = await appleIdToken(appleClientId);
      if (!idToken) {
        setBusy(false); // a pessoa fechou a janela
        return;
      }
      const result = await api.appleLogin(idToken);
      session.set(result.token);
      onLogin(result.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.');
      setBusy(false);
    }
  }

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
      <section className="login__hero">
        <img className="login__scene" src="/auth-hero.jpg" alt="AskouT" width="780" height="540" />
        <p className="login__headline">Menos tempo combinando. Mais tempo juntos.</p>
      </section>
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <img className="login__logo" src="/logo.png" alt="" width="40" height="40" />
          <span>AskouT Gestão</span>
        </div>
        <h1>Entrar</h1>
        <p className="login__sub">Acesso restrito a administradores.</p>
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
        <button type="submit" className="btn btn--primary btn--block login__submit" disabled={busy || identifier.trim() === '' || password === ''}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
        {appleClientId ? (
          <>
            <p className="login__or">ou</p>
            {appleImageFailed ? (
              <button type="button" className="btn btn--block" disabled={busy} onClick={() => void withApple()}>
                Continuar com a Apple
              </button>
            ) : (
              <button type="button" className="login__apple" aria-label="Continuar com a Apple" disabled={busy} onClick={() => void withApple()}>
                <img src={APPLE_BUTTON_URL} alt="" width="316" height="40" onError={() => setAppleImageFailed(true)} />
              </button>
            )}
          </>
        ) : null}
      </form>
    </main>
  );
}

function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const currentId = useId();
  const nextId = useId();
  const repeatId = useId();
  const mismatch = repeat !== '' && next !== repeat;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || current === '' || next === '' || next !== repeat) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Algo deu errado. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Modal title="Trocar senha" onClose={onClose}>
        <p className="notice" role="status">Senha alterada. Use a nova senha na próxima entrada.</p>
        <div className="modal__actions">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Trocar senha" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={currentId}>Senha atual</label>
          <input id={currentId} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus required />
        </div>
        <div className="field">
          <label htmlFor={nextId}>Nova senha</label>
          <input id={nextId} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
          <span className="muted small">Pelo menos 8 caracteres.</span>
        </div>
        <div className="field">
          <label htmlFor={repeatId}>Repita a nova senha</label>
          <input id={repeatId} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
          {mismatch ? <span className="muted small">As senhas não são iguais.</span> : null}
        </div>
        {error ? (
          <p className="notice notice--bad" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || current === '' || next === '' || next !== repeat}>
            {busy ? 'Aguarde…' : 'Trocar senha'}
          </button>
        </div>
      </form>
    </Modal>
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
  const [changingPassword, setChangingPassword] = useState(false);
  const closePassword = useCallback(() => setChangingPassword(false), []);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.stats().then(
        (s) => alive && setPending({ claims: s.pendingClaims, reports: s.openPostReports + s.openConversationReports + (s.openStoryReports ?? 0) + (s.openUserReports ?? 0) }),
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
        <div className="side__brand">
          <img src="/logo.png" alt="" width="28" height="28" />
          AskouT Gestão
        </div>
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
          <div className="side__actions">
            <button type="button" className="btn btn--small" onClick={() => setChangingPassword(true)}>
              Trocar senha
            </button>
            <button type="button" className="btn btn--small" onClick={onLogout}>
              Sair
            </button>
          </div>
        </div>
      </aside>
      <main className="main">
        <Page route={route} />
      </main>
      {changingPassword ? <ChangePasswordDialog onClose={closePassword} /> : null}
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
