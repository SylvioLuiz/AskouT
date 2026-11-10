import { Suspense, useEffect } from 'react';
import { FlashPresenceProvider } from './components/flash-presence.tsx';
import { AuthProvider, useAuthContext, useUser } from './auth.tsx';
import { Shell } from './components/Shell.tsx';
import { TermsGate } from './components/terms-gate.tsx';
import { Onboarding } from './components/onboarding.tsx';
import { PushAutoAsk } from './components/push-auto-ask.tsx';
import { RingLoader } from './components/ring-loader.tsx';
import { Button, EmptyState } from './components/ui.tsx';
import { useTitle } from './hooks.ts';
import { Link, navigate, resolveRoute, usePathname } from './router.tsx';
import type { RouteDef } from './router.tsx';
import { HomeScreen } from './screens/main-tabs.tsx';
import { t } from './lib/i18n/index.ts';
import { lazyWithReload } from './lib/chunk-reload.ts';

// Cada tela vira um arquivo separado, baixado só quando é aberta (antes tudo vinha junto na primeira carga).
// A Home fica no pacote principal por ser a primeira tela; as outras são aquecidas em segundo plano (ver warmScreens).
const DatePollScreen = lazyWithReload(() => import('./screens/date-poll.tsx').then((m) => ({ default: m.DatePollScreen })));
const AgendaScreen = lazyWithReload(() => import('./screens/agenda.tsx').then((m) => ({ default: m.AgendaScreen })));
const AccountDeletionInfoScreen = lazyWithReload(() => import('./screens/legal.tsx').then((m) => ({ default: m.AccountDeletionInfoScreen })));
const CsaeStandardsScreen = lazyWithReload(() => import('./screens/legal.tsx').then((m) => ({ default: m.CsaeStandardsScreen })));
const LegalScreen = lazyWithReload(() => import('./screens/legal.tsx').then((m) => ({ default: m.LegalScreen })));
const SupportScreen = lazyWithReload(() => import('./screens/legal.tsx').then((m) => ({ default: m.SupportScreen })));
const DeleteAccountScreen = lazyWithReload(() => import('./screens/delete-account.tsx').then((m) => ({ default: m.DeleteAccountScreen })));
const ChangePasswordScreen = lazyWithReload(() => import('./screens/change-password.tsx').then((m) => ({ default: m.ChangePasswordScreen })));
const MfaSettingsScreen = lazyWithReload(() => import('./screens/mfa-settings.tsx').then((m) => ({ default: m.MfaSettingsScreen })));
const ActivityScreen = lazyWithReload(() => import('./screens/activity.tsx').then((m) => ({ default: m.ActivityScreen })));
const ForgotPasswordScreen = lazyWithReload(() => import('./screens/auth.tsx').then((m) => ({ default: m.ForgotPasswordScreen })));
const LoginScreen = lazyWithReload(() => import('./screens/auth.tsx').then((m) => ({ default: m.LoginScreen })));
const SignupScreen = lazyWithReload(() => import('./screens/auth.tsx').then((m) => ({ default: m.SignupScreen })));
const ChatScreen = lazyWithReload(() => import('./screens/conversations.tsx').then((m) => ({ default: m.ChatScreen })));
const ConversationsScreen = lazyWithReload(() => import('./screens/conversations.tsx').then((m) => ({ default: m.ConversationsScreen })));
const FlashScreen = lazyWithReload(() => import('./screens/flash.tsx').then((m) => ({ default: m.FlashScreen })));
const MatchScreen = lazyWithReload(() => import('./screens/flash.tsx').then((m) => ({ default: m.MatchScreen })));
const DatePollCreateScreen = lazyWithReload(() => import('./components/date-poll-create.tsx').then((m) => ({ default: m.DatePollCreateScreen })));
const ChatInfoScreen = lazyWithReload(() => import('./screens/chat-info.tsx').then((m) => ({ default: m.ChatInfoScreen })));
const GroupScreen = lazyWithReload(() => import('./screens/group.tsx').then((m) => ({ default: m.GroupScreen })));
const VenueCalendarScreen = lazyWithReload(() => import('./screens/venue-calendar.tsx').then((m) => ({ default: m.VenueCalendarScreen })));
const CloakroomPanelScreen = lazyWithReload(() => import('./screens/cloakroom-panel.tsx').then((m) => ({ default: m.CloakroomPanelScreen })));
const BoostScreen = lazyWithReload(() => import('./screens/boost.tsx').then((m) => ({ default: m.BoostScreen })));
const VenuePageScreen = lazyWithReload(() => import('./screens/venue-page.tsx').then((m) => ({ default: m.VenuePageScreen })));
const VenuesScreen = lazyWithReload(() => import('./screens/venues.tsx').then((m) => ({ default: m.VenuesScreen })));
const EventScreen = lazyWithReload(() => import('./screens/event.tsx').then((m) => ({ default: m.EventScreen })));
const ExploreScreen = lazyWithReload(() => import('./screens/explore.tsx').then((m) => ({ default: m.ExploreScreen })));
const EventsMapScreen = lazyWithReload(() => import('./screens/events-map.tsx').then((m) => ({ default: m.EventsMapScreen })));
const ContactsScreen = lazyWithReload(() => import('./screens/contacts.tsx').then((m) => ({ default: m.ContactsScreen })));
const PrivacyDataScreen = lazyWithReload(() => import('./screens/privacy-data.tsx').then((m) => ({ default: m.PrivacyDataScreen })));
const AccountInfoScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.AccountInfoScreen })));
const BlockedScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.BlockedScreen })));
const EditProfileScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.EditProfileScreen })));
const FriendsScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.FriendsScreen })));
const HelpScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.HelpScreen })));
const InteractionsScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.InteractionsScreen })));
const NotificationSettingsScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.NotificationSettingsScreen })));
const NowSettingsScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.NowSettingsScreen })));
const PrivacyScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.PrivacyScreen })));
const SettingsScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.SettingsScreen })));
const ThemeScreen = lazyWithReload(() => import('./screens/me.tsx').then((m) => ({ default: m.ThemeScreen })));
const ConnectionsScreen = lazyWithReload(() => import('./screens/profile.tsx').then((m) => ({ default: m.ConnectionsScreen })));
const ProfileScreen = lazyWithReload(() => import('./screens/profile.tsx').then((m) => ({ default: m.ProfileScreen })));
const ArchivedScreen = lazyWithReload(() => import('./screens/posts.tsx').then((m) => ({ default: m.ArchivedScreen })));
const CreatePostScreen = lazyWithReload(() => import('./screens/posts.tsx').then((m) => ({ default: m.CreatePostScreen })));
const PostScreen = lazyWithReload(() => import('./screens/posts.tsx').then((m) => ({ default: m.PostScreen })));

const warmScreens = [
  () => import('./components/date-poll-create.tsx'),
  () => import('./screens/activity.tsx'),
  () => import('./screens/agenda.tsx'),
  () => import('./screens/auth.tsx'),
  () => import('./screens/boost.tsx'),
  () => import('./screens/change-password.tsx'),
  () => import('./screens/chat-info.tsx'),
  () => import('./screens/cloakroom-panel.tsx'),
  () => import('./screens/contacts.tsx'),
  () => import('./screens/conversations.tsx'),
  () => import('./screens/date-poll.tsx'),
  () => import('./screens/delete-account.tsx'),
  () => import('./screens/event.tsx'),
  () => import('./screens/events-map.tsx'),
  () => import('./screens/explore.tsx'),
  () => import('./screens/flash.tsx'),
  () => import('./screens/group.tsx'),
  () => import('./screens/legal.tsx'),
  () => import('./screens/me.tsx'),
  () => import('./screens/mfa-settings.tsx'),
  () => import('./screens/posts.tsx'),
  () => import('./screens/privacy-data.tsx'),
  () => import('./screens/profile.tsx'),
  () => import('./screens/venue-calendar.tsx'),
  () => import('./screens/venue-page.tsx'),
  () => import('./screens/venues.tsx'),
];

/** Depois que o app abriu, baixa as telas em segundo plano para que trocar de tela seja instantâneo. */
function warmUp(): void {
  const run = () => {
    for (const load of warmScreens) void load().catch(() => undefined);
  };
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(run, { timeout: 4000 });
  else window.setTimeout(run, 2000);
}

// Telas para quem ainda não entrou.
/** Páginas legais: abrem com ou sem login, fora do Shell. */
const LEGAL_ROUTES: RouteDef[] = [
  { path: '/politica-de-privacidade', render: () => <LegalScreen doc="privacy" /> },
  { path: '/termos-de-uso', render: () => <LegalScreen doc="terms" /> },
  { path: '/suporte', render: () => <SupportScreen /> },
  { path: '/excluir-conta', render: () => <AccountDeletionInfoScreen /> },
  { path: '/padroes-de-seguranca-infantil', render: () => <CsaeStandardsScreen /> },
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
  { path: '/now', render: () => <FlashScreen /> },
  { path: '/now/encontro/:id', render: (p) => <MatchScreen inviteId={p['id'] ?? ''} /> },
  // Endereços antigos (o NOW se chamava Flash): avisos já enviados e links salvos continuam funcionando.
  { path: '/flash', render: () => <Redirect to="/now" /> },
  { path: '/flash/encontro/:id', render: (p) => <Redirect to={`/now/encontro/${encodeURIComponent(p['id'] ?? '')}`} /> },
  { path: '/atividades', render: () => <ActivityScreen /> },
  { path: '/criar', render: () => <CreatePostScreen /> },
  { path: '/posts/:id', render: (p) => <PostScreen key={p['id']} postId={p['id'] ?? ''} /> },
  { path: '/perfil', render: () => <OwnProfile /> },
  { path: '/perfil/editar', render: () => <EditProfileScreen /> },
  { path: '/configuracao', render: () => <SettingsScreen /> },
  { path: '/configuracao/senha', render: () => <ChangePasswordScreen /> },
  { path: '/configuracao/verificacao-em-duas-etapas', render: () => <MfaSettingsScreen /> },
  { path: '/configuracao/conta', render: () => <AccountInfoScreen /> },
  { path: '/configuracao/notificacoes', render: () => <NotificationSettingsScreen /> },
  { path: '/configuracao/now', render: () => <NowSettingsScreen /> },
  { path: '/privacidade', render: () => <PrivacyScreen /> },
  { path: '/configuracao/privacidade-e-dados', render: () => <PrivacyDataScreen /> },
  { path: '/privacidade/apagar-conta', render: () => <DeleteAccountScreen /> },
  { path: '/arquivados', render: () => <ArchivedScreen /> },
  { path: '/interacoes', render: () => <InteractionsScreen /> },
  { path: '/ajuda', render: () => <HelpScreen /> },
  { path: '/tema', render: () => <ThemeScreen /> },
  { path: '/locais', render: () => <VenuesScreen /> },
  { path: '/bares/:id/eventos/:eventId/chapelaria', render: (p) => <CloakroomPanelScreen key={p['eventId']} venueId={p['id'] ?? ''} eventId={p['eventId'] ?? ''} /> },
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

function ScreenFallback() {
  return (
    <div className="screen-fallback" aria-busy="true">
      <RingLoader size={72} />
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
    if (state.status === 'user') warmUp();
  }, [state.status]);

  useEffect(() => {
    if (legal) return;
    if (state.status === 'user' && guest) navigate('/', { replace: true });
    if (state.status === 'guest' && !guest) navigate('/entrar', { replace: true });
  }, [state.status, guest, legal, pathname]);

  if (legal) return <Suspense fallback={<Splash />}>{legal.route.render(legal.params)}</Suspense>;
  if (state.status === 'loading') return <Splash />;

  if (state.status === 'failed') {
    return (
      <div className="splash">
        <EmptyState title={t('Não foi possível abrir o AskouT')}>{state.message}</EmptyState>
        <Button onClick={retry}>{t('Tentar de novo')}</Button>
      </div>
    );
  }

  if (state.status === 'guest') return guest ? <Suspense fallback={<Splash />}>{guest.route.render(guest.params)}</Suspense> : null;

  if (guest) return null; // redirecionando para a Home

  return (
    <FlashPresenceProvider>
      <TermsGate>
        <Shell>
          <Suspense fallback={<ScreenFallback />}>{priv ? priv.route.render(priv.params) : <NotFoundScreen />}</Suspense>
        </Shell>
        <Onboarding />
        <PushAutoAsk />
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
