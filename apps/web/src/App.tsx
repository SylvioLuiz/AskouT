import { useEffect } from 'react';
import { AuthProvider, useAuthContext } from './auth.tsx';
import { Shell } from './components/Shell.tsx';
import { Button, EmptyState } from './components/ui.tsx';
import { useTitle } from './hooks.ts';
import { Link, navigate, resolveRoute, usePathname } from './router.tsx';
import type { RouteDef } from './router.tsx';
import { AgendaScreen, CompareScreen, FriendAgendaScreen } from './screens/agenda.tsx';
import { ActivityScreen } from './screens/activity.tsx';
import { LoginScreen, SignupScreen } from './screens/auth.tsx';
import { ExploreScreen, HomeScreen, SoonScreen } from './screens/main-tabs.tsx';
import { BlockedScreen, FriendsScreen, MyProfileScreen } from './screens/me.tsx';
import { ConnectionsScreen, ProfileScreen } from './screens/profile.tsx';

// Telas para quem ainda não entrou.
const GUEST_ROUTES: RouteDef[] = [
  { path: '/entrar', render: () => <LoginScreen /> },
  { path: '/cadastro', render: () => <SignupScreen /> },
];

// Telas do app, dentro da navegação principal.
const PRIVATE_ROUTES: RouteDef[] = [
  { path: '/', render: () => <HomeScreen /> },
  { path: '/explorar', render: () => <ExploreScreen /> },
  { path: '/conversas', render: () => <SoonScreen title="Conversas" text="As conversas com seus amigos chegam numa próxima etapa." /> },
  { path: '/agenda', render: () => <AgendaScreen /> },
  { path: '/agenda/comparar', render: () => <CompareScreen /> },
  { path: '/atividades', render: () => <ActivityScreen /> },
  { path: '/perfil', render: () => <MyProfileScreen /> },
  { path: '/amigos', render: () => <FriendsScreen /> },
  { path: '/bloqueados', render: () => <BlockedScreen /> },
  { path: '/u/:username', render: (p) => <ProfileScreen username={p['username'] ?? ''} /> },
  { path: '/u/:username/agenda', render: (p) => <FriendAgendaScreen username={p['username'] ?? ''} /> },
  { path: '/u/:username/seguidores', render: (p) => <ConnectionsScreen username={p['username'] ?? ''} direction="followers" /> },
  { path: '/u/:username/seguindo', render: (p) => <ConnectionsScreen username={p['username'] ?? ''} direction="following" /> },
];

function NotFoundScreen() {
  useTitle('Página não encontrada');
  return (
    <EmptyState
      title="Página não encontrada"
      action={
        <Link to="/" className="btn btn--primary">
          Ir para a Home
        </Link>
      }
    >
      O endereço não existe ou mudou de lugar.
    </EmptyState>
  );
}

function Splash() {
  return (
    <div className="splash" role="status">
      <span className="wordmark wordmark--big">AskouT</span>
      <span className="visually-hidden">Carregando</span>
    </div>
  );
}

function AppRoutes() {
  const { state, retry } = useAuthContext();
  const pathname = usePathname();
  const guest = resolveRoute(GUEST_ROUTES, pathname);
  const priv = resolveRoute(PRIVATE_ROUTES, pathname);

  useEffect(() => {
    if (state.status === 'user' && guest) navigate('/', { replace: true });
    if (state.status === 'guest' && !guest) navigate('/entrar', { replace: true });
  }, [state.status, guest, pathname]);

  if (state.status === 'loading') return <Splash />;

  if (state.status === 'failed') {
    return (
      <div className="splash">
        <EmptyState title="Não foi possível abrir o AskouT">{state.message}</EmptyState>
        <Button onClick={retry}>Tentar de novo</Button>
      </div>
    );
  }

  if (state.status === 'guest') return guest ? <>{guest.route.render(guest.params)}</> : null;

  if (guest) return null; // redirecionando para a Home
  return <Shell>{priv ? priv.route.render(priv.params) : <NotFoundScreen />}</Shell>;
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
