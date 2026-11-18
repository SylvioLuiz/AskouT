import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, session, setUnauthorizedHandler } from './client.ts';
import { toApiError } from './lib/errors.ts';
import type { AuthResult, MfaChallenge, PublicProfile, SessionUser } from './lib/types.ts';
import { MfaStep } from './components/mfa-step.tsx';
import { navigate } from './router.tsx';
import { t } from './lib/i18n/index.ts';

type AuthState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'failed'; message: string }
  | { status: 'user'; user: SessionUser };

interface AuthContextValue {
  state: AuthState;
  /** Com verificação em duas etapas ligada, mostra a tela do código antes de entrar. */
  signIn: (result: AuthResult | MfaChallenge) => void;
  signOut: () => void;
  setOwnProfile: (profile: PublicProfile) => void;
  /** Troca os dados da sessão (ex.: depois de completar o cadastro do Google/Apple). */
  setSessionUser: (user: SessionUser) => void;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** No máximo uma renovação a cada 12 horas. */
const RENEW_EVERY_MS = 12 * 60 * 60 * 1000;
let lastRenewAt = 0;

/**
 * Troca o token por um novo, com prazo zerado, para a sessão só expirar depois de muito tempo sem abrir o app
 * (como nas redes sociais). Falha de rede é ignorada: o token atual continua valendo.
 */
function renewSession(): void {
  const now = Date.now();
  if (now - lastRenewAt < RENEW_EVERY_MS) return;
  lastRenewAt = now;
  api.refreshSession().catch(() => {
    lastRenewAt = 0;
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [challenge, setChallenge] = useState<MfaChallenge | undefined>();

  const signOut = useCallback(() => {
    session.clear();
    setState({ status: 'guest' });
    navigate('/entrar', { replace: true });
  }, []);

  // Sessão expirada ou inválida em qualquer chamada: volta para a entrada com um aviso.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      session.clear();
      setState({ status: 'guest' });
      navigate('/entrar?expirou=1', { replace: true });
    });
  }, []);

  // Ao abrir o app, confere se o token guardado ainda vale.
  useEffect(() => {
    if (session.get() === undefined) {
      setState({ status: 'guest' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    api.me().then(
      (user) => {
        if (cancelled) return;
        setState({ status: 'user', user });
        renewSession();
      },
      (failure: unknown) => {
        if (cancelled) return;
        const error = toApiError(failure);
        if (error.code === 'UNAUTHORIZED') {
          session.clear();
          setState({ status: 'guest' });
        } else {
          setState({ status: 'failed', message: error.message });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // App aberto por dias (aba esquecida, app em segundo plano): renova quando volta para a frente.
  useEffect(() => {
    if (state.status !== 'user') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') renewSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [state.status]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signIn: (result) => {
        if ('mfaRequired' in result) {
          setChallenge(result);
          return;
        }
        setChallenge(undefined);
        session.set(result.token);
        lastRenewAt = Date.now();
        setState({ status: 'user', user: result.user });
      },
      signOut,
      setOwnProfile: (profile) =>
        setState((current) => (current.status === 'user' ? { status: 'user', user: { ...current.user, profile } } : current)),
      setSessionUser: (user) => setState({ status: 'user', user }),
      retry: () => setAttempt((n) => n + 1),
    }),
    [state, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {challenge ? <MfaStep challenge={challenge} onDone={(result) => value.signIn(result)} onCancel={() => setChallenge(undefined)} /> : children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error(t('useAuthContext fora do AuthProvider'));
  return value;
}

/** Usuário logado; só use dentro de telas privadas (o roteador garante que existe). */
export function useUser(): SessionUser {
  const { state } = useAuthContext();
  if (state.status !== 'user') throw new Error(t('useUser fora de uma tela privada'));
  return state.user;
}
