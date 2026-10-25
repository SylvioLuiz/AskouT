import { DatePollScreen } from './screens/date-poll.tsx';
import { useEffect } from 'react';
import { FlashPresenceProvider } from './components/flash-presence.tsx';
import { AuthProvider, useAuthContext, useUser } from './auth.tsx';
import { Shell } from './components/Shell.tsx';
import { TermsGate } from './components/terms-gate.tsx';
import { Onboarding } from './components/onboarding.tsx';
import { RingLoader } from './components/ring-loader.tsx';
import { Button, EmptyState } from './components/ui.tsx';
import { useTitle } from './hooks.ts';
import { Link, navigate, resolveRoute, usePathname } from './router.tsx';
import type { RouteDef } from './router.tsx';
import { AgendaScreen } from './screens/agenda.tsx';
import { LegalScreen } from './screens/legal.tsx';
import { DeleteAccountScreen } from './screens/delete-account.tsx';
import { ActivityScreen } from './screens/activity.tsx';
import { ForgotPasswordScreen, LoginScreen, SignupScreen } from './screens/auth.tsx';
import { ChatScreen, ConversationsScreen } from './screens/conversations.tsx';
import { FlashScreen, MatchScreen } from './screens/flash.tsx';
import { DatePollCreateScreen } from './components/date-poll-create.tsx';
import { ChatInfoScreen } from './screens/chat-info.tsx';
import { GroupScreen } from './screens/group.tsx';
import { VenueCalendarScreen } from './screens/venue-calendar.tsx';
import { BoostScreen } from './screens/boost.tsx';
import { VenuePageScreen } from './screens/venue-page.tsx';
import { VenuesScreen } from './screens/venues.tsx';
import { EventScreen } from './screens/event.tsx';
import { ExploreScreen } from './screens/explore.tsx';
import { EventsMapScreen } from './screens/events-map.tsx';
import { HomeScreen } from './screens/main-tabs.tsx';
import { ContactsScreen } from './screens/contacts.tsx';
import { BlockedScreen, EditProfileScreen, FriendsScreen, HelpScreen, InteractionsScreen, PrivacyScreen, SettingsScreen, ThemeScreen } from './screens/me.tsx';
import { ConnectionsScreen, ProfileScreen } from './screens/profile.tsx';
import { ArchivedScreen, CreatePostScreen, PostScreen } from './screens/posts.tsx';
import { t } from './lib/i18n/index.ts';

// Telas para quem ainda não entrou.
/** Páginas legais: abrem com ou sem login, fora do Shell. */
const LEGAL_ROUTES: RouteDef[] = [
  { path: '/politica-de-privacidade', render: () => <LegalScreen doc="privacy" /> },
  { path: '/termos-de-uso', render: () => <LegalScreen doc="terms" /> },
];

const GUEST_ROUTES: RouteDef[] = [
  { path: '/entrar', render: () => <LoginScreen /> },
  { path: '/cadastro', render: () => <SignupScreen /> },
  { path: '/esqueci-senha', render: () => <ForgotPasswordScreen /> },
];

function OwnProfile() {
  const user = useUser();
  return <ProfileScreen key={user.profile.username} username={user.profile.username} />;
}

// Telas do app, dentro da navegação principal.
const PRIVATE_ROUTES: RouteDef[] = [
  { path: '/', render: () => <HomeScreen /> },
  { path: '/explorar', render: () => <ExploreScreen /> },
  { path: '/explorar/mapa', render: () => <EventsMapScreen /> },
  { path: '/eventos/:id', render: (p) => <EventScreen key={p['id']} eventId={p['id'] ?? ''} /> },
  { path: '/conversas', render: () => <ConversationsScreen /> },
  { path: '/conversas/:id/info', render: (p) => <ChatInfoScreen key={p['id']} conversationId={p['id'] ?? ''} /> },
  { path: '/conversas/:id/grupo', render: (p) => <GroupScreen key={p['id']} conversationId={p['id'] ?? ''} /> },
  { path: '/conversas/:id', render: (p) => <ChatScreen key={p['id']} conversationId={p['id'] ?? ''} /> },
  { path: '/planejar/nova/:id', render: (p) => <DatePollCreateScreen key={p['id']} conversationId={p['id'] ?? ''} /> },
  { path: '/planejar/:id', render: (p) => <DatePollScreen key={p['id']} pollId={p['id'] ?? ''} /> },
  { path: '/agenda', render: () => <AgendaScreen /> },
  { path: '/flash', render: () => <FlashScreen /> },
  { path: '/flash/encontro/:id', render: (p) => <MatchScreen inviteId={p['id'] ?? ''} /> },
  { path: '/atividades', render: () => <ActivityScreen /> },
  { path: '/criar', render: () => <CreatePostScreen /> },
  { path: '/posts/:id', render: (p) => <PostScreen key={p['id']} postId={p['id'] ?? ''} /> },
  { path: '/perfil', render: () => <OwnProfile /> },
  { path: '/perfil/editar', render: () => <EditProfileScreen /> },
  { path: '/configuracao', render: () => <SettingsScreen /> },
  { path: '/privacidade', render: () => <PrivacyScreen /> },
  { path: '/privacidade/apagar-conta', render: () => <DeleteAccountScreen /> },
  { path: '/arquivados', render: () => <ArchivedScreen /> },
  { path: '/interacoes', render: () => <InteractionsScreen /> },
  { path: '/ajuda', render: () => <HelpScreen /> },
  { path: '/tema', render: () => <ThemeScreen /> },
  { path: '/locais', render: () => <VenuesScreen /> },
  { path: '/bares/:id/agenda', render: (p) => <VenueCalendarScreen key={p['id']} venueId={p['id'] ?? ''} /> },
  { path: '/locais/:id/agenda', render: (p) => <Redirect to={`/bares/${encodeURIComponent(p['id'] ?? '')}/agenda`} /> },
  { path: '/bares/:id/impulsionar', render: (p) => <BoostScreen key={p['id']} venueId={p['id'] ?? ''} /> },
  { path: '/bares/:id', render: (p) => <VenuePageScreen key={p['id']} venueId={p['id'] ?? ''} /> },
  { path: '/locais/:id', render: (p) => <Redirect to={`/bares/${encodeURIComponent(p['id'] ?? '')}`} /> },
  { path: '/amigos', render: () => <FriendsScreen /> },
  { path: '/amigos/contatos', render: () => <ContactsScreen /> },
  { path: '/bloqueados', render: () => <BlockedScreen /> },
  { path: '/u/:username', render: (p) => <ProfileScreen username={p['username'] ?? ''} /> },
  { path: '/u/:username/seguidores', render: (p) => <ConnectionsScreen username={p['username'] ?? ''} direction="followers" /> },
  { path: '/u/:username/seguindo', render: (p) => <ConnectionsScreen username={p['username'] ?? ''} direction="following" /> },
];

/** Endereços antigos continuam funcionando: leva ao novo e não deixa o antigo no histórico. */
function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function NotFoundScreen() {
  useTitle(t('Página não encontrada'));
  return (
    <EmptyState
      title={t('Página não encontrada')}
      action={
        <Link to="/" className="btn btn--primary">
          {t('Ir para a Home')}
        </Link>
      }
    >
      {t('O endereço não existe ou mudou de lugar.')}
    </EmptyState>
  );
}

function Splash() {
  return (
    <div className="splash splash--night">
      <RingLoader size={176} />
    </div>
  );
}

function AppRoutes() {
  const { state, retry } = useAuthContext();
  const pathname = usePathname();
  const guest = resolveRoute(GUEST_ROUTES, pathname);
  const priv = resolveRoute(PRIVATE_ROUTES, pathname);
  const legal = resolveRoute(LEGAL_ROUTES, pathname);

  useEffect(() => {
    if (legal) return;
    if (state.status === 'user' && guest) navigate('/', { replace: true });
    if (state.status === 'guest' && !guest) navigate('/entrar', { replace: true });
  }, [state.status, guest, legal, pathname]);

  if (legal) return <>{legal.route.render(legal.params)}</>;
  if (state.status === 'loading') return <Splash />;

  if (state.status === 'failed') {
    return (
      <div className="splash">
        <EmptyState title={t('Não foi possível abrir o AskouT')}>{state.message}</EmptyState>
        <Button onClick={retry}>{t('Tentar de novo')}</Button>
      </div>
    );
  }

  if (state.status === 'guest') return guest ? <>{guest.route.render(guest.params)}</> : null;

  if (guest) return null; // redirecionando para a Home
  return (
    <FlashPresenceProvider>
      <TermsGate>
        <Shell>{priv ? priv.route.render(priv.params) : <NotFoundScreen />}</Shell>
        <Onboarding />
      </TermsGate>
    </FlashPresenceProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
