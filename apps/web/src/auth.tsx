import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, session, setUnauthorizedHandler } from './client.ts';
import { toApiError } from './lib/errors.ts';
import type { AuthResult, PublicProfile, SessionUser } from './lib/types.ts';
import { navigate } from './router.tsx';

type AuthState =
  | { status: 'loading' }
  | { status: 'guest' }
  | { status: 'failed'; message: string }
  | { status: 'user'; user: SessionUser };

interface AuthContextValue {
  state: AuthState;
  signIn: (result: AuthResult) => void;
  signOut: () => void;
  setOwnProfile: (profile: PublicProfile) => void;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

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
        if (!cancelled) setState({ status: 'user', user });
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

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      signIn: (result) => {
        session.set(result.token);
        setState({ status: 'user', user: result.user });
      },
      signOut,
      setOwnProfile: (profile) =>
        setState((current) => (current.status === 'user' ? { status: 'user', user: { ...current.user, profile } } : current)),
      retry: () => setAttempt((n) => n + 1),
    }),
    [state, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuthContext fora do AuthProvider');
  return value;
}

/** Usuário logado; só use dentro de telas privadas (o roteador garante que existe). */
export function useUser(): SessionUser {
  const { state } = useAuthContext();
  if (state.status !== 'user') throw new Error('useUser fora de uma tela privada');
  return state.user;
}
