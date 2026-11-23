import { errorFromResponse, networkError } from './errors.ts';
import type { ConfirmationAnswer, PollInput, PollSummary, PollView, VoteStatus } from './date-poll.ts';
import type { BusyBlock, CalendarChoice, CalendarConnection, CalendarOverview } from './calendar-sync.ts';
import type { DwellEntry } from './dwell.ts';
import type { BoostStatEntry } from './boost-stats.ts';
import type { ActivityFilter, ActivityPage } from './activity-log.ts';
import type { SuggestedPerson } from './suggested-people.ts';
import type {
  LinkedAccounts,
  UsernameCheck,
  ConsentPurpose,
  ConsentStatus,
  BoostPricing,
  Recommendations,
  BoostView,
  BoostReport,
  NearbyOffer,
  OfferView,
  VenueOffers,
  MatchReach,
  RegionView,
  ClaimableVenue,
  CalendarPanel,
  CalendarDraft,
  ExploreEvent,
  MyVenues,
  VenueTeam,
  VenueClaim,
  VenueEvent,
  VenueEventBody,
  VenueProfile,
  VenueBell,
  VenueCheckinCode,
  VenueCheckinResult,
  OrganizationRequestBody,
  VenueRequestBody,
  VenueRating,
  VenueProfileBody,
  VenuePanel,
  AuthResult,
  MfaChallenge,
  MfaSetup,
  MfaStatus,
  PasswordResetStarted,
  AvailableFriend,
  AvailableList,
  AvailableOrder,
  ChatMessage,
  ChatReaction,
  ChatView,
  ConversationItem,
  MessageRequestRole,
  SuggestionCard,
  Suggestions,
  FlashInvite,
  FlashInvites,
  FlashMatch,
  FlashRoutes,
  FlashStatus,
  FlashVisibility,
  StoryVisibility,
  SharedView,
  Slot,
  SlotInput,
  ConnectionsPage,
  EventKind,
  EventPage,
  EventInvite,
  NotificationMute,
  EventStoryGroup,
  CommentGif,
  RollingNowItem,
  VenueStoryGroup,
  VenueStoryItem,
  VenueStoryOwnerView,
  VenueStorySettings,
  FeedComment,
  GifResults,
  GuestListOwnerView,
  GuestListView,
  FeedPage,
  FeedPolicy,
  FeedPost,
  FeedReactions,
  FeedSettings,
  GroupDetails,
  GoingEvent,
  MeetupView,
  AlbumDetail,
  AlbumPhoto,
  AlbumSummary,
  NotificationCategory,
  NotificationList,
  PushTestResult,
  PostedEventsPage,
  AttendedEventsPage,
  PostComment,
  PostCommentsPage,
  PostEdit,
  PostImageInput,
  ReportReason,
  PostsPage,
  HomeFeedPage,
  PostView,
  ExploreParams,
  ExploreResult,
  ExplorePlace,
  PageRequest,
  Profile,
  ProfilePatch,
  ProfileView,
  ReferralOverview,
  PublicProfile,
  SessionUser,
  SignupInput,
  AgeStatus,
  TermsStatus,
  SignupStarted,
  SocialNeedsProfile,
  SocialProvider,
  SocialProviderId,
} from './types.ts';
import type { CloakroomPanel, CloakroomPublic, CloakroomSettingBody, CloakroomStaffTicket, CloakroomTicket } from './cloakroom.ts';
import type { EventExtraAnswer, EventExtraOption, StoryOverlay } from './types.ts';
import type { TasteDefinition } from './themes.ts';
import { overlaysHeader } from './story-overlays.ts';
import { t } from '../lib/i18n/index.ts';

/** O mínimo de `fetch` que o cliente usa (facilita testar sem navegador). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string | Blob },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  blob(): Promise<Blob>;
}>;

export interface ApiDeps {
  baseUrl: string;
  fetch: FetchLike;
  getToken: () => string | undefined;
  /** Chamado quando uma chamada autenticada recebe 401 (sessão expirada ou inválida). */
  onUnauthorized: () => void;
  /** Token novo emitido pelo servidor (renovação ou troca de senha): guarde no lugar do atual. */
  onToken?: (token: string) => void;
}

interface RequestOptions {
  body?: unknown;
  /** Falso nas rotas públicas (cadastro e login): não envia o token. */
  auth?: boolean;
}

function pageQuery(page: PageRequest | undefined): string {
  const params: string[] = [];
  if (page?.limit !== undefined) params.push(`limit=${page.limit}`);
  if (page?.offset !== undefined) params.push(`offset=${page.offset}`);
  return params.length > 0 ? `?${params.join('&')}` : '';
}

const id = encodeURIComponent;

/** De qual página é o feed: de um evento ou de um rolê (o trecho da rota na API). */
export type FeedWhere = 'events' | 'venues';

/** Query string só com o que veio preenchido. */
function toQuery(values: Record<string, string | number | undefined>): string {
  const params = Object.entries(values).flatMap(([key, value]) => (value === undefined || value === '' ? [] : [`${key}=${encodeURIComponent(String(value))}`]));
  return params.length > 0 ? `?${params.join('&')}` : '';
}

export function createApi(deps: ApiDeps) {
  // Pedidos GET idênticos feitos ao mesmo tempo (ex.: duas telas pedindo a mesma lista) viram uma só ida à rede.
  const inFlight = new Map<string, Promise<unknown>>();

  function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    if (method !== 'GET') return send<T>(method, path, options);
    const key = `${options.auth === false ? '' : (deps.getToken() ?? '')}|${path}`;
    const running = inFlight.get(key);
    if (running) return running as Promise<T>;
    const started = send<T>(method, path, options);
    inFlight.set(key, started);
    const done = () => {
      if (inFlight.get(key) === started) inFlight.delete(key);
    };
    started.then(done, done);
    return started;
  }

  async function send<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false;
    const token = useAuth ? deps.getToken() : undefined;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token !== undefined) headers['Authorization'] = t('Bearer {token}', { token });
    let body: string | undefined;
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    let response;
    try {
      response = await deps.fetch(`${deps.baseUrl}${path}`, { method, headers, body });
    } catch {
      throw networkError();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    if (response.ok) return payload as T;

    const error = errorFromResponse(response.status, payload, response.headers.get('Retry-After'));
    // Só derruba a sessão se o token recusado ainda é o atual (outra chamada pode já ter trocado por um novo).
    if (error.code === 'UNAUTHORIZED' && token !== undefined && token === deps.getToken()) deps.onUnauthorized();
    throw error;
  }

  /** Sem login (modo visitante): Explorar, mapa, evento e local vêm das leituras públicas, sem dados de pessoas. */
  const visitor = () => deps.getToken() === undefined;

  return {
    // Cadastro e sessão
    startSignup: (input: SignupInput) => request<SignupStarted>('POST', '/auth/signup', { body: input, auth: false }),
    resendSignupCode: (email: string) =>
      request<SignupStarted>('POST', '/auth/signup/resend', { body: { email }, auth: false }),
    confirmSignup: (email: string, code: string) =>
      request<AuthResult>('POST', '/auth/signup/confirm', { body: { email, code }, auth: false }),
    requestPasswordReset: (identifier: string) =>
      request<PasswordResetStarted>('POST', '/auth/password-reset', { body: { identifier }, auth: false }),
    confirmPasswordReset: (identifier: string, code: string, password: string) =>
      request<AuthResult | MfaChallenge>('POST', '/auth/password-reset/confirm', { body: { identifier, code, password }, auth: false }),
    login: (identifier: string, password: string) =>
      request<AuthResult | MfaChallenge>('POST', '/auth/login', { body: { identifier, password }, auth: false }),
    socialProviders: () => request<{ items: SocialProvider[]; phone?: { authenticator: boolean; sms: boolean } }>('GET', '/auth/providers', { auth: false }),
    /** Entrar pelo celular, sem senha, etapa 1: devolve o desafio; a etapa 2 é `mfaVerify` com o código do app autenticador. */
    phoneLogin: (phone: string) => request<MfaChallenge>('POST', '/auth/phone/login', { body: { phone }, auth: false }),
    socialLogin: (input: { provider: SocialProviderId; idToken: string; username?: string; displayName?: string; birthDate?: string; acceptTerms?: boolean; marketingEmail?: boolean }) =>
      request<AuthResult | MfaChallenge | SocialNeedsProfile>('POST', '/auth/social', { body: input, auth: false }),
    mfaVerify: (mfaToken: string, code: string) =>
      request<AuthResult>('POST', '/auth/mfa/verify', { body: { mfaToken, code }, auth: false }),
    mfaStatus: () => request<MfaStatus>('GET', '/auth/mfa'),
    mfaSetup: () => request<MfaSetup>('POST', '/auth/mfa/setup'),
    mfaEnable: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/auth/mfa/enable', { body: { code } }),
    mfaDisable: (code: string) => request<{ enabled: false }>('POST', '/auth/mfa/disable', { body: { code } }),
    mfaRecoveryCodes: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/auth/mfa/recovery-codes', { body: { code } }),
    me: () => request<SessionUser>('GET', '/auth/me'),
    /** Renova o token (o app chama ao abrir): a sessão só expira depois de muito tempo sem uso. */
    refreshSession: async () => {
      const { token } = await request<{ token: string }>('POST', '/auth/refresh');
      deps.onToken?.(token);
    },
    completeOnboarding: () => request<{ onboarded: true }>('POST', '/auth/me/onboarding'),
    setTastes: (tastes: readonly string[]) => request<{ tastes: string[] }>('PUT', '/auth/me/tastes', { body: { tastes } }),
    /** "Complete seu cadastro" de quem entrou pela primeira vez com Google/Apple. */
    completeProfile: (input: { username: string; birthDate: string; acceptTerms: boolean; marketingEmail?: boolean }) =>
      request<SessionUser>('POST', '/auth/me/profile', { body: input }),
    usernameAvailable: (username: string) => request<UsernameCheck>('GET', `/auth/me/username-available?username=${id(username)}`),
    linkedAccounts: () => request<LinkedAccounts>('GET', '/auth/me/linked-accounts'),
    linkAccount: (provider: SocialProviderId, idToken: string) => request<LinkedAccounts>('POST', '/auth/me/linked-accounts', { body: { provider, idToken } }),
    unlinkAccount: (provider: SocialProviderId) => request<LinkedAccounts>('DELETE', `/auth/me/linked-accounts/${id(provider)}`),

    // Perfis
    searchProfiles: (query: string, limit?: number) =>
      request<PublicProfile[]>(
        'GET',
        `/profiles/search?q=${id(query)}${limit !== undefined ? `&limit=${limit}` : ''}`,
      ),
    claimReferral: (inviter: string) => request<{ counted: boolean }>('POST', '/me/referral', { body: { inviter } }),
    referrals: () => request<ReferralOverview>('GET', '/me/referrals'),
    setReferralBadgeHidden: (hidden: boolean) => request<{ badgeHidden: boolean }>('PUT', '/me/referral-badge', { body: { hidden } }),
    getProfile: (username: string) => request<ProfileView>('GET', `/profiles/${id(username)}`),
    setProfilePhoto: (image: string | null) => request<Profile>('PUT', '/profiles/me/photo', { body: { image } }),
    getPhone: () => request<{ phone: string | null; verified?: boolean }>('GET', '/profiles/me/phone'),
    setPhone: (phone: string | null) => request<{ phone: string | null; verified?: boolean }>('PUT', '/profiles/me/phone', { body: { phone } }),
    profileEvents: (username: string, page?: PageRequest) => request<PostedEventsPage>('GET', `/profiles/${id(username)}/events${pageQuery(page)}`),
    attendedEvents: (username: string, page?: PageRequest) => request<AttendedEventsPage>('GET', `/profiles/${id(username)}/attended${pageQuery(page)}`),
    shownGoingEvents: (username: string, page?: PageRequest) => request<AttendedEventsPage>('GET', `/profiles/${id(username)}/going${pageQuery(page)}`),
    postEvent: (eventId: string) => request<{ posted: true }>('POST', `/events/${id(eventId)}/post`),
    unpostEvent: (eventId: string) => request<{ posted: false }>('DELETE', `/events/${id(eventId)}/post`),
    sendGif: (conversationId: string, gif: CommentGif, replyToId?: string) =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { gif, ...(replyToId ? { replyToId } : {}) } }),
    sendEvent: (conversationId: string, eventId: string) => request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { eventId } }),
    createPost: (input: { images: PostImageInput[]; caption?: string; placeName?: string; placeAddress?: string; placeVenueId?: string; linkedEventId?: string; tagUserIds?: string[]; event?: { title: string; kind?: EventKind; startsAt?: string | null; endsAt?: string | null; dateByPoll?: boolean; private?: boolean; extras?: EventExtraAnswer[] }; datePollId?: string }) => request<PostView>('POST', '/posts', { body: input }),
    /** Configurações de evento cadastradas pela gestão, para responder ao criar ou editar um evento. */
    eventExtras: () => request<{ items: EventExtraOption[] }>('GET', '/event-extras'),
    /** Gostos de rolê cadastrados pela gestão (cadastro, configurações e filtro do Explorar). */
    tastes: () => request<{ items: TasteDefinition[] }>('GET', '/tastes', { auth: false }),
    post: (postId: string) => request<PostView>('GET', `/posts/${id(postId)}`),
    /** Anexa o vídeo ao item de foto que serve de capa: o arquivo vai cru no corpo, com o tipo no Content-Type. */
    attachPostVideo: async (postId: string, imageId: string, file: Blob, onProgress?: (sent: number, total: number) => void): Promise<PostView> => {
      const token = deps.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': file.type };
      if (token !== undefined) headers['Authorization'] = t('Bearer {token}', { token });
      const url = `${deps.baseUrl}/posts/${id(postId)}/images/${id(imageId)}/video`;
      let status: number;
      let payload: unknown;
      let retryAfter: string | null = null;
      if (onProgress && typeof XMLHttpRequest !== 'undefined') {
        // O fetch não informa quanto já foi enviado; o XMLHttpRequest informa, e a tela mostra a porcentagem.
        try {
          const result = await new Promise<{ status: number; body: string; retryAfter: string | null }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
            xhr.upload.onprogress = (e) => onProgress(e.lengthComputable ? e.loaded : 0, e.lengthComputable ? e.total : file.size);
            xhr.onload = () => resolve({ status: xhr.status, body: xhr.responseText, retryAfter: xhr.getResponseHeader('Retry-After') });
            xhr.onerror = () => reject(new Error('rede'));
            xhr.ontimeout = () => reject(new Error('rede'));
            xhr.onabort = () => reject(new Error('rede'));
            xhr.send(file);
          });
          status = result.status;
          retryAfter = result.retryAfter;
          try {
            payload = JSON.parse(result.body);
          } catch {
            payload = undefined;
          }
        } catch {
          throw networkError();
        }
      } else {
        let response;
        try {
          response = await deps.fetch(url, { method: 'POST', headers, body: file });
        } catch {
          throw networkError();
        }
        status = response.status;
        retryAfter = response.headers.get('Retry-After');
        try {
          payload = await response.json();
        } catch {
          payload = undefined;
        }
      }
      if (status >= 200 && status < 300) return payload as PostView;
      const error = errorFromResponse(status, payload, retryAfter);
      // Só derruba a sessão se o token recusado ainda é o atual (outra chamada pode já ter trocado por um novo).
      if (error.code === 'UNAUTHORIZED' && token !== undefined && token === deps.getToken()) deps.onUnauthorized();
      throw error;
    },
    deletePost: (postId: string) => request<{ deleted: true }>('DELETE', `/posts/${id(postId)}`),
    pendingTags: (page?: PageRequest) => request<PostsPage>('GET', `/posts/pending-tags${pageQuery(page)}`),
    respondTag: (postId: string, action: 'accept' | 'decline') => request<{ status: 'ACCEPTED' | 'DECLINED' }>('POST', `/posts/${id(postId)}/tag`, { body: { action } }),
    likePost: (postId: string) => request<{ liked: true; likeCount: number }>('POST', `/posts/${id(postId)}/like`),
    unlikePost: (postId: string) => request<{ liked: false; likeCount: number }>('DELETE', `/posts/${id(postId)}/like`),
    postComments: (postId: string, page?: PageRequest) => request<PostCommentsPage>('GET', `/posts/${id(postId)}/comments${pageQuery(page)}`),
    addComment: (postId: string, body: string, gif?: CommentGif, replyTo?: string) => request<PostComment>('POST', `/posts/${id(postId)}/comments`, { body: { body, ...(gif ? { gif } : {}), ...(replyTo ? { replyTo } : {}) } }),
    gifStatus: () => request<{ enabled: boolean }>('GET', '/gifs/status'),
    gifs: (q: string, offset: number, lang: string) => request<GifResults>('GET', `/gifs${toQuery({ q: q.trim() || undefined, offset: offset || undefined, lang })}`),
    likeComment: (postId: string, commentId: string, liked: boolean) =>
      request<{ liked: boolean; likeCount: number }>(liked ? 'POST' : 'DELETE', `/posts/${id(postId)}/comments/${id(commentId)}/like`),
    deleteComment: (postId: string, commentId: string) => request<{ deleted: true }>('DELETE', `/posts/${id(postId)}/comments/${id(commentId)}`),
    reportProfile: (username: string, reason: ReportReason, details?: string) => request<{ reported: true }>('POST', `/profiles/${id(username)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    reportComment: (postId: string, commentId: string, reason: ReportReason, details?: string) => request<{ reported: true }>('POST', `/posts/${id(postId)}/comments/${id(commentId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    reportPost: (postId: string, reason: ReportReason, details?: string) => request<{ reported: true }>('POST', `/posts/${id(postId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    notInterested: (postId: string) => request<{ hidden: true }>('POST', `/posts/${id(postId)}/not-interested`),
    editPost: (postId: string, patch: PostEdit) => request<PostView>('PATCH', `/posts/${id(postId)}`, { body: patch }),
    adjustPostImage: (postId: string, imageId: string, image: string) => request<PostView>('PUT', `/posts/${id(postId)}/images/${id(imageId)}`, { body: { image } }),
    archivePost: (postId: string) => request<{ archived: true }>('POST', `/posts/${id(postId)}/archive`),
    unarchivePost: (postId: string) => request<{ archived: false }>('DELETE', `/posts/${id(postId)}/archive`),
    archivedPosts: (page?: PageRequest) => request<PostsPage>('GET', `/posts/archived${pageQuery(page)}`),
    postsFeed: (page?: PageRequest) => request<PostsPage>('GET', `/posts/feed${pageQuery(page)}`),
    /** Início com eventos de bares repostados misturados (`type: 'PLACE_EVENT'`). */
    homeFeed: (page?: PageRequest, before?: string) => request<HomeFeedPage>('GET', `/posts/feed${pageQuery(page)}${pageQuery(page) ? '&' : '?'}mixed=1${before ? `&before=${encodeURIComponent(before)}` : ''}`),
    userPosts: (username: string, page?: PageRequest, kind?: 'event' | 'post') => request<PostsPage>('GET', `/profiles/${id(username)}/posts${pageQuery(page)}${kind ? `${page ? '&' : '?'}kind=${kind}` : ''}`),
    myMeetups: () => request<{ items: MeetupView[] }>('GET', '/meetups'),
    /** `recentDays`: inclui também os que acabaram há até tantos dias (escolher o evento de um post). */
    myGoingEvents: (recentDays?: number) => request<{ items: GoingEvent[] }>('GET', `/me/events/going${recentDays ? `?recentDays=${recentDays}` : ''}`),
    updateProfile: (patch: ProfilePatch) => request<Profile>('PATCH', '/profiles/me', { body: patch }),
    setPrivacy: (isPrivate: boolean) =>
      request<{ isPrivate: boolean; acceptedPending: number }>('PATCH', '/profiles/me/privacy', {
        body: { isPrivate },
      }),

    // Seguir
    follow: (userId: string) =>
      request<{ status: 'PENDING' | 'ACCEPTED'; isFriend: boolean }>('POST', `/users/${id(userId)}/follow`),
    unfollow: (userId: string) => request<{ removed: boolean }>('DELETE', `/users/${id(userId)}/follow`),
    followers: (userId: string, page?: PageRequest) =>
      request<ConnectionsPage>('GET', `/users/${id(userId)}/followers${pageQuery(page)}`),
    following: (userId: string, page?: PageRequest) =>
      request<ConnectionsPage>('GET', `/users/${id(userId)}/following${pageQuery(page)}`),
    mutualFriends: (userId: string) => request<{ items: PublicProfile[]; total: number }>('GET', `/users/${id(userId)}/mutual-friends`),
    followRequests: (page?: PageRequest) =>
      request<ConnectionsPage>('GET', `/me/follow-requests${pageQuery(page)}`),
    approveRequest: (userId: string) =>
      request<{ isFriend: boolean }>('POST', `/me/follow-requests/${id(userId)}/approve`),
    rejectRequest: (userId: string) => request<{ ok: true }>('POST', `/me/follow-requests/${id(userId)}/reject`),
    removeFollower: (userId: string) => request<{ ok: true }>('DELETE', `/me/followers/${id(userId)}`),
    contactMatches: (hashes: string[], phoneHashes: string[] = []) => request<{ items: PublicProfile[] }>('POST', '/me/contact-matches', { body: { hashes, phoneHashes } }),
    suggestedPeople: () => request<{ items: SuggestedPerson[]; followingCount: number }>('GET', '/me/suggested-people'),
    friends: () => request<PublicProfile[]>('GET', '/me/friends'),

    // Agenda
    mySlots: (from: string, to: string) =>
      request<Slot[]>('GET', `/me/availability?from=${id(from)}&to=${id(to)}`),
    addSlot: (input: SlotInput) => request<Slot>('POST', '/me/availability', { body: input }),
    removeSlot: (slotId: string) => request<{ removed: boolean }>('DELETE', `/me/availability/${id(slotId)}`),

    // Sincronizar agendas (celular, Google Agenda, links iCal): só horários ocupados
    calendarOverview: () => request<CalendarOverview>('GET', '/me/calendars'),
    calendarBusy: (from: string, to: string) => request<BusyBlock[]>('GET', `/me/calendars/busy?from=${id(from)}&to=${id(to)}`),
    saveDeviceCalendars: (input: { calendars: CalendarChoice[]; intervals: { start: string; end: string }[] }) => request<CalendarConnection>('PUT', '/me/calendars/device', { body: input }),
    startGoogleCalendar: (from: 'web' | 'app') => request<{ url: string }>('POST', '/me/calendars/google/start', { body: { from } }),
    startMicrosoftCalendar: (from: 'web' | 'app') => request<{ url: string }>('POST', '/me/calendars/microsoft/start', { body: { from } }),
    setCalendarSelection: (connectionId: string, calendarIds: string[]) => request<CalendarConnection>('PUT', `/me/calendars/${id(connectionId)}/selection`, { body: { calendarIds } }),
    syncMyCalendar: (connectionId: string) => request<CalendarConnection>('POST', `/me/calendars/${id(connectionId)}/sync`),
    removeMyCalendar: (connectionId: string) => request<void>('DELETE', `/me/calendars/${id(connectionId)}`),

    // Flash
    flashStatus: () => request<FlashStatus>('GET', '/me/flash'),
    /** `area`: posição do aparelho (o servidor arredonda para ~1 km e só usa para ordenar "mais perto"). */
    flashOn: (minutes: number, note: string, area?: { lat: number; lng: number }) =>
      request<FlashStatus>('POST', '/me/flash', { body: { minutes, ...(note === '' ? {} : { note }), ...(area ?? {}) } }),
    flashExtend: (minutes: 30 | 60) => request<FlashStatus>('POST', '/me/flash/extend', { body: { minutes } }),
    flashSetNote: (note: string) => request<FlashStatus>('PUT', '/me/flash/note', { body: { note } }),
    flashOff: () => request<{ ended: boolean }>('DELETE', '/me/flash'),
    flashActive: () => request<{ userIds: string[] }>('GET', '/flash/active'),
    flashVisibility: (userId: string) => request<FlashVisibility>('GET', `/flash/visibility/${id(userId)}`),
    setFlashVisibility: (userId: string, body: Partial<FlashVisibility>) => request<FlashVisibility>('PUT', `/flash/visibility/${id(userId)}`, { body }),
    storyVisibility: (userId: string) => request<StoryVisibility>('GET', `/stories/visibility/${id(userId)}`),
    setStoryVisibility: (userId: string, body: Partial<StoryVisibility>) => request<StoryVisibility>('PUT', `/stories/visibility/${id(userId)}`, { body }),
    flashAvailable: (order?: AvailableOrder) => request<AvailableList>('GET', `/flash/available${order ? `?ordem=${order === 'near' ? 'perto' : 'interacao'}` : ''}`),
    flashInvites: () => request<FlashInvites>('GET', '/flash/invites'),
    /** "Perguntar se está livre": cada amigo recebe um aviso que abre o NOW dele. */
    flashAsk: (userIds: string[]) => request<{ asked: string[]; skipped: string[] }>('POST', '/flash/ask', { body: { userIds } }),
    /** `fix`: sua posição agora; quem aceitar já vê você no mapa (ninguém vê antes do aceite). */
    flashInvite: (userId: string, approx = false, fix?: { lat: number; lng: number; accuracyM: number }) => request<FlashInvite>('POST', '/flash/invites', { body: { userId, approx, ...(fix ?? {}) } }),
    flashRespond: (inviteId: string, action: 'accept' | 'decline', approx = false, fix?: { lat: number; lng: number; accuracyM: number }) =>
      request<{ status: 'ACCEPTED' | 'DECLINED'; conversationId: string | null }>('POST', `/flash/invites/${id(inviteId)}/respond`, { body: action === 'accept' ? { action, approx, ...(fix ?? {}) } : { action } }),
    flashSetPrecision: (inviteId: string, approx: boolean) => request<{ approx: boolean }>('PUT', `/flash/matches/${id(inviteId)}/precision`, { body: { approx } }),
    /** Liberar (ou parar) a outra pessoa de acompanhar a sua chegada nas notificações do celular. */
    flashSetArrival: (inviteId: string, share: boolean) => request<{ share: boolean }>('PUT', `/flash/matches/${id(inviteId)}/arrival`, { body: { share } }),
    flashEnd: (inviteId: string) => request<{ ended: boolean }>('DELETE', `/flash/invites/${id(inviteId)}`),
    flashMatch: (inviteId: string) => request<FlashMatch>('GET', `/flash/matches/${id(inviteId)}`),
    flashShareLocation: (inviteId: string, position: { lat: number; lng: number; accuracyM?: number }) =>
      request<{ ok: true }>('PUT', `/flash/matches/${id(inviteId)}/location`, { body: position }),

    flashChooseDestination: (inviteId: string, place: { name: string; lat: number; lng: number }) => request<{ ok: true }>('PUT', `/flash/matches/${id(inviteId)}/destination`, { body: place }),
    flashClearDestination: (inviteId: string) => request<{ ok: true }>('DELETE', `/flash/matches/${id(inviteId)}/destination`),
    flashRoutes: (inviteId: string, mode: 'foot' | 'driving') => request<FlashRoutes>('GET', `/flash/matches/${id(inviteId)}/routes?modo=${mode === 'driving' ? 'carro' : 'a-pe'}`),
    flashSuggestions: (inviteId: string, radiusKm?: number | null, innerKm?: number) =>
      request<Suggestions>('GET', `/flash/matches/${id(inviteId)}/suggestions${radiusKm ? `?raioKm=${radiusKm}${innerKm ? `&desdeKm=${innerKm}` : ''}` : ''}`),

    notificationMute: () => request<NotificationMute>('GET', '/notifications/settings'),
    setNotificationMute: (patch: Partial<NotificationMute>) => request<NotificationMute>('PUT', '/notifications/settings', { body: patch }),

    // Explorar
    explore: (params: ExploreParams) => {
      const query = new URLSearchParams();
      if (params.q) query.set('q', params.q);
      if (params.lat !== undefined && params.lng !== undefined) {
        query.set('lat', String(params.lat));
        query.set('lng', String(params.lng));
      }
      if (params.radiusKm !== undefined) query.set('radiusKm', String(params.radiusKm));
      if (params.from) query.set('from', params.from);
      if (params.to) query.set('to', params.to);
      if (params.kind) query.set('kind', params.kind);
      if (params.free) query.set('free', 'true');
      if (params.hot) query.set('hot', 'true');
      if (params.offset) query.set('offset', String(params.offset));
      const text = query.toString();
      return visitor() ? request<ExploreResult>('GET', `/public/explore${text ? `?${text}` : ''}`, { auth: false }) : request<ExploreResult>('GET', `/explore${text ? `?${text}` : ''}`);
    },
    /** Locais perto (AskouT + Google/OSM) para os pins do mapa do Explorar. */
    explorePlaces: (params: { lat: number; lng: number; radiusKm?: number }) => {
      const query = new URLSearchParams({ lat: String(params.lat), lng: String(params.lng) });
      if (params.radiusKm !== undefined) query.set('radiusKm', String(params.radiusKm));
      return request<{ places: ExplorePlace[]; placesAvailable: boolean }>('GET', `${visitor() ? '/public' : ''}/explore/places?${query.toString()}`, visitor() ? { auth: false } : {});
    },
    /** Vincular um rolê: locais do AskouT e lugares do Google pelo nome ou endereço, em qualquer lugar. */
    searchPlaces: (params: { q: string; lat?: number | undefined; lng?: number | undefined }) => {
      const query = new URLSearchParams({ q: params.q });
      if (params.lat !== undefined && params.lng !== undefined) {
        query.set('lat', String(params.lat));
        query.set('lng', String(params.lng));
      }
      return request<{ places: ExplorePlace[]; placesAvailable: boolean }>('GET', `/explore/place-search?${query.toString()}`);
    },
    /** `position`: onde a pessoa está, para pesar eventos perto. Vai arredondada (~1 km); o servidor não guarda. */
    recommendations: (personalize: boolean, position?: { lat: number; lng: number }) =>
      request<Recommendations>('GET', `/me/recommendations?personalize=${personalize ? 'true' : 'false'}${position ? `&lat=${position.lat.toFixed(2)}&lng=${position.lng.toFixed(2)}` : ''}`),
    recordDwell: (items: DwellEntry[]) => request<{ saved: number }>('POST', '/me/dwell', { body: { items } }),
    eraseDwell: () => request<{ removed: number }>('DELETE', '/me/dwell'),
    boostPricing: () => request<BoostPricing>('GET', '/boosts/pricing'),
    venueBoosts: (venueId: string) => request<{ items: BoostView[] }>('GET', `/me/venues/${id(venueId)}/boosts`),
    createBoost: (venueId: string, body: { target: 'VENUE' | 'EVENT'; eventId?: string; days: number; audience?: 'ALL' | 'MATCH'; radiusKm?: number; tags?: string[]; channel?: 'WEB' | 'APPLE' | 'GOOGLE' }) => request<BoostView>('POST', `/me/venues/${id(venueId)}/boosts`, { body }),
    matchReach: (venueId: string, q: { eventId: string; radiusKm: number; tags: string[] }) =>
      request<MatchReach>('GET', `/me/venues/${id(venueId)}/boosts/estimate?eventId=${encodeURIComponent(q.eventId)}&radiusKm=${q.radiusKm}&tags=${q.tags.map(encodeURIComponent).join(',')}`),
    region: () => request<{ region: RegionView | null }>('GET', '/me/region'),
    saveRegion: (lat: number, lng: number) => request<{ region: RegionView }>('PUT', '/me/region', { body: { lat, lng } }),
    /** Cópia dos meus dados (LGPD). */
    /** Se já informei a data de nascimento e se tenho 18 anos ou mais (libera o Flash). */
    ageStatus: () => request<AgeStatus>('GET', '/me/age'),
    /** Corrige a data de nascimento (não vale para quem consta como menor de 18 anos). */
    correctBirthDate: (birthDate: string) => request<AgeStatus>('PUT', '/me/age', { body: { birthDate } }),
    /** Informa a data de nascimento (AAAA-MM-DD). Só vale uma vez. */
    declareAge: (birthDate: string) => request<AgeStatus>('POST', '/me/age', { body: { birthDate } }),
    termsStatus: () => request<TermsStatus>('GET', '/me/terms'),
    acceptTerms: (version: string) => request<TermsStatus>('POST', '/me/terms', { body: { version } }),
    /** Consentimentos opcionais, aceite dos Termos e histórico. */
    consents: () => request<ConsentStatus>('GET', '/me/consents'),
    setConsent: (purpose: ConsentPurpose, granted: boolean) => request<ConsentStatus>('PUT', '/me/consents', { body: { purpose, granted } }),
    exportMyData: () => request<{ filename: string; data: Record<string, unknown> }>('GET', '/me/export'),
    /** Se a minha conta tem senha própria (quem entra só com Google/Apple não tem). */
    passwordStatus: () => request<{ hasPassword: boolean }>('GET', '/me/password'),
    /** Troca a minha senha, conferindo a atual. */
    createPassword: async (newPassword: string) => {
      const result = await request<{ hasPassword: true; token?: string }>('POST', '/me/password/create', { body: { newPassword } });
      if (result.token) deps.onToken?.(result.token);
      return { hasPassword: true as const };
    },
    /** Os outros aparelhos saem; este recebe um token novo e continua logado. */
    changePassword: async (input: { currentPassword: string; newPassword: string }) => {
      const result = await request<{ token?: string } | undefined>('POST', '/me/password', { body: input });
      if (result?.token) deps.onToken?.(result.token);
    },
    /** Apaga a minha conta de vez. Conta que entra com Google/Apple não manda senha. */
    deleteMyAccount: (input: { username: string; password?: string }) => request<{ deleted: true }>('DELETE', '/me', { body: input }),
    clearRegion: () => request<{ removed: boolean }>('DELETE', '/me/region'),
    /** Relatório do anúncio (só para quem pagou). */
    boostReport: (boostId: string) => request<BoostReport>('GET', `/me/boosts/${id(boostId)}/report`),
    /** O que apareceu como "Patrocinado" (o servidor decide a qual anúncio pertence). */
    trackBoostStats: (items: BoostStatEntry[]) => request<{ counted: number }>('POST', '/me/boost-stats', { body: { items } }),
    nearbyOffers: () => request<{ items: NearbyOffer[] }>('GET', '/offers/nearby'),
    venueOffers: (venueId: string) => request<VenueOffers>('GET', `/me/venues/${id(venueId)}/offers`),
    createOffer: (venueId: string, body: { text: string; minutes: number }) => request<OfferView>('POST', `/me/venues/${id(venueId)}/offers`, { body }),
    endOffer: (offerId: string) => request<OfferView>('POST', `/me/offers/${id(offerId)}/end`),
    cancelBoost: (boostId: string) => request<BoostView>('POST', `/me/boosts/${id(boostId)}/cancel`),
    simulateBoostPayment: (boostId: string) => request<BoostView>('POST', `/me/boosts/${id(boostId)}/simulate-payment`),
    confirmStorePurchase: (boostId: string, receipt: string) => request<BoostView>('POST', `/me/boosts/${id(boostId)}/store-purchase`, { body: { receipt } }),
    sponsoredEvents: () => request<{ events: ExploreEvent[] }>('GET', '/explore/sponsored'),
    followedEvents: () => request<{ events: ExploreEvent[] }>('GET', '/explore/followed-events'),
    eventPage: (eventId: string, position?: { lat: number; lng: number }) =>
      request<EventPage>('GET', `${visitor() ? '/public' : ''}/events/${id(eventId)}${position ? `?lat=${position.lat}&lng=${position.lng}` : ''}`, visitor() ? { auth: false } : {}),
    /** Quem já foi convidado para o evento (marcado ou recebeu o cartão). O dono vê todos; os demais, quem eles convidaram. */
    eventInvites: (eventId: string) => request<{ invites: EventInvite[] }>('GET', `/events/${id(eventId)}/invites`),
    /** Cria o grupo do evento (só quem criou o evento) ou devolve o que já existe em que você está. */
    createEventGroup: (eventId: string) => request<{ id: string; created: boolean }>('POST', `/events/${id(eventId)}/group`),
    /** Aba Álbum do evento: SOON antes de começar, LOCKED para quem não confirmou, OPEN com o álbum. */
    eventAlbum: (eventId: string) => request<{ state: 'SOON'; startsAt: string | null } | { state: 'LOCKED' } | { state: 'OPEN'; album: AlbumDetail }>('GET', `/events/${id(eventId)}/album`),
    eventStories: (eventId: string) => request<{ groups: EventStoryGroup[] }>('GET', `/events/${id(eventId)}/stories`),
    /**
     * `onProfile`: publica também no perfil, para os amigos verem na página inicial.
     * `overlays`: textos e figurinhas por cima, num cabeçalho (o corpo é a mídia crua).
     */
    createEventStory: async (eventId: string, file: Blob, onProfile = false, overlays: readonly StoryOverlay[] = []): Promise<EventStoryGroup> => {
      const token = deps.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': file.type };
      const overlayHeader = overlaysHeader(overlays);
      if (overlayHeader) headers['X-Story-Overlays'] = overlayHeader;
      if (token !== undefined) headers['Authorization'] = t('Bearer {token}', { token });
      let response;
      try {
        const query = new URLSearchParams();
        if (onProfile) query.set('profile', '1');
        const qs = query.toString();
        response = await deps.fetch(`${deps.baseUrl}/events/${id(eventId)}/stories${qs ? `?${qs}` : ''}`, { method: 'POST', headers, body: file });
      } catch {
        throw networkError();
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (response.ok) return payload as EventStoryGroup;
      const error = errorFromResponse(response.status, payload, response.headers.get('Retry-After'));
      // Só derruba a sessão se o token recusado ainda é o atual (outra chamada pode já ter trocado por um novo).
      if (error.code === 'UNAUTHORIZED' && token !== undefined && token === deps.getToken()) deps.onUnauthorized();
      throw error;
    },
    deleteEventStory: (eventId: string, storyId: string) => request<{ deleted: true }>('DELETE', `/events/${id(eventId)}/stories/${id(storyId)}`),
    reportEventStory: (eventId: string, storyId: string, reason: ReportReason, details?: string) =>
      request<{ reported: true }>('POST', `/events/${id(eventId)}/stories/${id(storyId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    /** Página inicial: os seus stories e os dos amigos publicados também no perfil. */
    profileStories: () => request<{ groups: EventStoryGroup[] }>('GET', '/stories/friends'),
    deleteProfileStory: (storyId: string) => request<{ deleted: true }>('DELETE', `/stories/${id(storyId)}`),
    reportProfileStory: (storyId: string, reason: ReportReason, details?: string) =>
      request<{ reported: true }>('POST', `/stories/${id(storyId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    /** Reage a um story: entre amigos vira mensagem na conversa; sem amizade (story de evento), um aviso para quem publicou. */
    reactProfileStory: (storyId: string, emoji: string) => request<{ sent: true; conversationId: string | null }>('POST', `/stories/${id(storyId)}/react`, { body: { emoji } }),
    reactEventStory: (eventId: string, storyId: string, emoji: string) => request<{ sent: true; conversationId: string | null }>('POST', `/events/${id(eventId)}/stories/${id(storyId)}/react`, { body: { emoji } }),
    /** Responde ao story com texto: entre amigos vai direto para a conversa; senão, chega como aviso. Sem `eventId`, pela página inicial. */
    replyStory: (storyId: string, text: string, eventId?: string) =>
      request<{ sent: true; conversationId: string | null }>('POST', eventId ? `/events/${id(eventId)}/stories/${id(storyId)}/reply` : `/stories/${id(storyId)}/reply`, { body: { text } }),
    /** Coração do story (fica guardado; quem publicou recebe um aviso). */
    likeStory: (storyId: string, liked: boolean, eventId?: string) =>
      request<{ liked: boolean }>('POST', eventId ? `/events/${id(eventId)}/stories/${id(storyId)}/like` : `/stories/${id(storyId)}/like`, { body: { liked } }),
    /** Marca o story de outra pessoa como visto (uma vez por pessoa; quem publicou vê só a contagem). */
    viewStory: (storyId: string, eventId?: string) =>
      request<{ viewed: true }>('POST', eventId ? `/events/${id(eventId)}/stories/${id(storyId)}/view` : `/stories/${id(storyId)}/view`, { body: {} }),
    storyMediaUrl: (storyId: string) => `${deps.baseUrl}/stories/media/${id(storyId)}`,
    eventGo: (eventId: string, onProfile?: boolean) => request<EventPage>('POST', `/events/${id(eventId)}/going`, onProfile === undefined ? {} : { body: { onProfile } }),
    setGoingOnProfile: (eventId: string, onProfile: boolean) => request<EventPage>('PATCH', `/events/${id(eventId)}/going`, { body: { onProfile } }),

    // Stories públicos de locais verificados
    venueStoriesHome: () => request<{ groups: VenueStoryGroup[] }>('GET', '/venue-stories/home'),
    /** A posição vale só nesta consulta (o servidor arredonda e não guarda). */
    rollingNow: (position?: { lat: number; lng: number }) => request<{ items: RollingNowItem[] }>('GET', `/venue-stories/rolling-now${position ? `?lat=${position.lat}&lng=${position.lng}` : ''}`),
    venueStoryMediaUrl: (storyId: string) => `${deps.baseUrl}/venue-stories/${id(storyId)}/media`,
    reportVenueStory: (storyId: string, reason: ReportReason, details?: string) =>
      request<{ reported: true }>('POST', `/venue-stories/${id(storyId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    muteVenueStories: (venueId: string, muted: boolean) => request<{ muted: boolean }>('PUT', `/venue-stories/venues/${id(venueId)}/mute`, { body: { muted } }),
    venueStorySettings: () => request<VenueStorySettings>('GET', '/venue-stories/settings'),
    setVenueStorySettings: (hideVenueStories: boolean) => request<VenueStorySettings>('PUT', '/venue-stories/settings', { body: { hideVenueStories } }),
    ownerVenueStories: (venueId: string) => request<VenueStoryOwnerView>('GET', `/me/venues/${id(venueId)}/stories`),
    publishVenueStory: async (venueId: string, file: Blob): Promise<VenueStoryItem> => {
      const token = deps.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': file.type };
      if (token !== undefined) headers['Authorization'] = t('Bearer {token}', { token });
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/me/venues/${id(venueId)}/stories`, { method: 'POST', headers, body: file });
      } catch {
        throw networkError();
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (response.ok) return payload as VenueStoryItem;
      const error = errorFromResponse(response.status, payload, response.headers.get('Retry-After'));
      if (error.code === 'UNAUTHORIZED' && token !== undefined) deps.onUnauthorized();
      throw error;
    },
    deleteVenueStory: (venueId: string, storyId: string) => request<{ deleted: true }>('DELETE', `/me/venues/${id(venueId)}/stories/${id(storyId)}`),
    eventCancel: (eventId: string) => request<EventPage>('DELETE', `/events/${id(eventId)}/going`),

    // Feed das páginas de evento (`events`) e de rolê (`venues`)
    feed: (where: FeedWhere, targetId: string, query: { cursor?: string | null; limit?: number } = {}) =>
      request<FeedPage>('GET', `/${where}/${id(targetId)}/feed${toQuery({ cursor: query.cursor ?? undefined, limit: query.limit })}`),
    createFeedPost: (where: FeedWhere, targetId: string, input: { kind: 'POST' | 'NOTICE'; body?: string; images?: string[] }) => request<FeedPost>('POST', `/${where}/${id(targetId)}/feed`, { body: input }),
    setFeedPolicy: (where: FeedWhere, targetId: string, policy: FeedPolicy) => request<FeedSettings>('PUT', `/${where}/${id(targetId)}/feed/policy`, { body: { policy } }),
    feedPending: (where: FeedWhere, targetId: string) => request<{ items: FeedPost[] }>('GET', `/${where}/${id(targetId)}/feed/pending`),
    feedPost: (postId: string) => request<FeedPost>('GET', `/feed/posts/${id(postId)}`),
    deleteFeedPost: (postId: string) => request<{ deleted: true }>('DELETE', `/feed/posts/${id(postId)}`),
    approveFeedPost: (postId: string) => request<FeedPost>('POST', `/feed/posts/${id(postId)}/approve`),
    rejectFeedPost: (postId: string) => request<{ rejected: true }>('POST', `/feed/posts/${id(postId)}/reject`),
    reactFeedPost: (postId: string, emoji: string | null) => request<FeedReactions>('PUT', `/feed/posts/${id(postId)}/reaction`, { body: { emoji } }),
    feedComments: (postId: string, cursor?: string | null) => request<{ items: FeedComment[]; nextCursor: string | null }>('GET', `/feed/posts/${id(postId)}/comments${toQuery({ cursor: cursor ?? undefined })}`),
    addFeedComment: (postId: string, body: string, gif?: CommentGif, replyTo?: string) => request<FeedComment>('POST', `/feed/posts/${id(postId)}/comments`, { body: { body, ...(gif ? { gif } : {}), ...(replyTo ? { replyTo } : {}) } }),
    deleteFeedComment: (commentId: string) => request<{ deleted: true }>('DELETE', `/feed/comments/${id(commentId)}`),
    reactFeedComment: (commentId: string, emoji: string | null) => request<FeedReactions>('PUT', `/feed/comments/${id(commentId)}/reaction`, { body: { emoji } }),
    reportFeedPost: (postId: string, reason: ReportReason, details?: string) => request<{ reported: true }>('POST', `/feed/posts/${id(postId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    reportFeedComment: (commentId: string, reason: ReportReason, details?: string) => request<{ reported: true }>('POST', `/feed/comments/${id(commentId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),

    // Lista VIP (nome na lista) dos eventos de locais
    guestList: (eventId: string) => request<GuestListView>('GET', `/events/${id(eventId)}/guest-list`),
    joinGuestList: (eventId: string, companions: number) => request<GuestListView>('POST', `/events/${id(eventId)}/guest-list/join`, { body: { companions } }),
    leaveGuestList: (eventId: string) => request<GuestListView>('DELETE', `/events/${id(eventId)}/guest-list/join`),
    configureGuestList: (eventId: string, input: { enabled: boolean; limit?: number | null; closesAt?: string | null; maxCompanions?: number }) => request<GuestListView>('PUT', `/events/${id(eventId)}/guest-list`, { body: input }),
    guestListEntries: (eventId: string) => request<GuestListOwnerView>('GET', `/events/${id(eventId)}/guest-list/entries`),
    checkInGuest: (eventId: string, userId: string, checkedIn: boolean) => request<GuestListOwnerView>('PUT', `/events/${id(eventId)}/guest-list/entries/${id(userId)}/check-in`, { body: { checkedIn } }),
    exportGuestList: (eventId: string) => request<{ filename: string; csv: string }>('GET', `/events/${id(eventId)}/guest-list/export`),

    // Locais (painel do local)
    myVenues: () => request<MyVenues>('GET', '/me/venues'),
    claimableVenues: (q: string) => request<ClaimableVenue[]>('GET', `/venues/claimable?q=${encodeURIComponent(q)}`),
    claimVenue: (venueId: string, input: { document: string; note?: string }) => request<VenueClaim>('POST', `/venues/${id(venueId)}/claims`, { body: input }),
    cancelClaim: (claimId: string) => request<{ cancelled: true }>('DELETE', `/venue-claims/${id(claimId)}`),
    venuePanel: (venueId: string) => request<VenuePanel>('GET', `/me/venues/${id(venueId)}`),
    calendarPanel: (venueId: string) => request<CalendarPanel>('GET', `/me/venues/${id(venueId)}/calendar`),
    saveCalendar: (venueId: string, body: { url?: string; leadDays?: number; enabled?: boolean }) => request<CalendarPanel>('PUT', `/me/venues/${id(venueId)}/calendar`, { body }),
    removeCalendar: (venueId: string) => request<{ removed: true }>('DELETE', `/me/venues/${id(venueId)}/calendar`),
    syncCalendar: (venueId: string) => request<CalendarPanel>('POST', `/me/venues/${id(venueId)}/calendar/sync`),
    editCalendarDraft: (venueId: string, draftId: string, body: VenueEventBody) => request<CalendarDraft>('PUT', `/me/venues/${id(venueId)}/calendar/drafts/${id(draftId)}`, { body }),
    approveCalendarDraft: (venueId: string, draftId: string) => request<CalendarDraft | { published: true; eventId: string }>('POST', `/me/venues/${id(venueId)}/calendar/drafts/${id(draftId)}/approve`),
    dismissCalendarDraft: (venueId: string, draftId: string) => request<{ dismissed: true }>('POST', `/me/venues/${id(venueId)}/calendar/drafts/${id(draftId)}/dismiss`),
    createVenueEvent: (venueId: string, body: VenueEventBody) => request<VenueEvent>('POST', `/me/venues/${id(venueId)}/events`, { body }),
    updateVenueEvent: (venueId: string, eventId: string, body: VenueEventBody) => request<VenueEvent>('PUT', `/me/venues/${id(venueId)}/events/${id(eventId)}`, { body }),
    venueTeam: (venueId: string) => request<VenueTeam>('GET', `/me/venues/${id(venueId)}/team`),
    inviteVenueManager: (venueId: string, username: string) => request<VenueTeam>('POST', `/me/venues/${id(venueId)}/team`, { body: { username } }),
    removeVenueManager: (venueId: string, userId: string) => request<VenueTeam>('DELETE', `/me/venues/${id(venueId)}/team/${id(userId)}`),
    respondVenueInvite: (venueId: string, accept: boolean) => request<{ accepted: boolean }>('POST', `/me/venues/${id(venueId)}/team/invite`, { body: { accept } }),
    leaveVenueTeam: (venueId: string) => request<{ left: true }>('DELETE', `/me/venues/${id(venueId)}/team`),
    // A API ainda sem equipe não manda canManage/role: o responsável continua administrando.
    venueProfile: (venueId: string) => request<VenueProfile>('GET', visitor() ? `/public/venues/${id(venueId)}` : `/venues/${id(venueId)}/profile`, visitor() ? { auth: false } : {}).then((v) => ({ ...v, canManage: v.canManage ?? v.isOwner, role: v.role ?? (v.isOwner ? ('OWNER' as const) : null) })),
    updateVenueProfile: (venueId: string, body: VenueProfileBody) => request<VenueProfile>('PUT', `/me/venues/${id(venueId)}/profile`, { body }),
    followVenue: (venueId: string) => request<{ following: true; followerCount: number }>('POST', `/venues/${id(venueId)}/follow`),
    /** QR do local: o código atual (gerado na primeira vez) e a troca, que invalida o QR impresso. */
    venueCheckinCode: (venueId: string) => request<VenueCheckinCode>('GET', `/me/venues/${id(venueId)}/checkin`),
    rotateVenueCheckinCode: (venueId: string) => request<VenueCheckinCode>('POST', `/me/venues/${id(venueId)}/checkin/rotate`),
    /** "Estive aqui": o código vem do link do QR. */
    venueCheckin: (venueId: string, code: string) => request<VenueCheckinResult>('POST', `/venues/${id(venueId)}/checkin`, { body: { code } }),
    rateVenue: (venueId: string, stars: number) => request<VenueRating>('PUT', `/venues/${id(venueId)}/rating`, { body: { stars } }),
    clearVenueRating: (venueId: string) => request<VenueRating>('DELETE', `/venues/${id(venueId)}/rating`),
    unfollowVenue: (venueId: string) => request<{ following: false; followerCount: number }>('DELETE', `/venues/${id(venueId)}/follow`),
    /** Sininho: liga (e já segue) ou desliga o aviso de cada evento novo. */
    setVenueNotify: (venueId: string, notify: boolean) => request<VenueBell>('PUT', `/venues/${id(venueId)}/notify`, { body: { notify } }),
    requestVenue: (body: VenueRequestBody) => request<VenueClaim>('POST', '/venues/requests', { body }),
    requestOrganization: (body: OrganizationRequestBody) => request<VenueClaim>('POST', '/organizations/requests', { body }),
    venuePosts: (venueId: string, page?: PageRequest) => request<PostsPage>('GET', `/venues/${id(venueId)}/posts${pageQuery(page)}`),
    createVenuePost: (venueId: string, input: { images: string[]; caption?: string }) => request<PostView>('POST', `/me/venues/${id(venueId)}/posts`, { body: input }),
    openExternalVenue: (input: { key: string; lat: number; lng: number }) => request<{ venueId: string }>('POST', '/venues/external', { body: input }),
    cloakroom: (eventId: string) => request<CloakroomPublic>('GET', `/events/${id(eventId)}/cloakroom`),
    requestCloakroomTicket: (eventId: string, body: { description: string; itemCount: number }) => request<CloakroomTicket>('POST', `/events/${id(eventId)}/cloakroom/tickets`, { body }),
    cancelCloakroomTicket: (ticketId: string) => request<CloakroomTicket>('DELETE', `/cloakroom/tickets/${id(ticketId)}`),
    cloakroomPanel: (venueId: string, eventId: string) => request<CloakroomPanel>('GET', `/me/venues/${id(venueId)}/events/${id(eventId)}/cloakroom`),
    saveCloakroom: (venueId: string, eventId: string, body: CloakroomSettingBody) => request<CloakroomPanel>('PUT', `/me/venues/${id(venueId)}/events/${id(eventId)}/cloakroom`, { body }),
    cloakroomLookup: (venueId: string, eventId: string, code: string) => request<CloakroomStaffTicket>('POST', `/me/venues/${id(venueId)}/events/${id(eventId)}/cloakroom/lookup`, { body: { code } }),
    cloakroomReceive: (venueId: string, eventId: string, code: string) => request<CloakroomStaffTicket>('POST', `/me/venues/${id(venueId)}/events/${id(eventId)}/cloakroom/receive`, { body: { code } }),
    cloakroomReturn: (venueId: string, eventId: string, code: string) => request<CloakroomStaffTicket>('POST', `/me/venues/${id(venueId)}/events/${id(eventId)}/cloakroom/return`, { body: { code } }),
    deleteVenueEvent: (venueId: string, eventId: string) => request<{ deleted: true }>('DELETE', `/me/venues/${id(venueId)}/events/${id(eventId)}`),

    // Conversas
    /** `requestCount`/`requestUnread`: solicitações de mensagem esperando (servidor antigo não manda). */
    conversations: () => request<{ items: ConversationItem[]; requestCount?: number; requestUnread?: number }>('GET', '/conversations'),
    /** Mensagem pela página de um local com dono: abre (ou cria) a conversa com o local. */
    openVenueConversation: (venueId: string) => request<{ id: string }>('POST', '/conversations/venue', { body: { venueId } }),
    messageRequests: () => request<{ items: ConversationItem[] }>('GET', '/conversations/requests'),
    acceptMessageRequest: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/request/accept`),
    declineMessageRequest: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/request/decline`),
    messageSettings: () => request<{ openDms: boolean; isPrivate: boolean }>('GET', '/conversations/settings'),
    setMessageSettings: (openDms: boolean) => request<{ openDms: boolean; isPrivate: boolean }>('PUT', '/conversations/settings', { body: { openDms } }),
    createGroup: (name: string, memberIds: string[]) => request<{ id: string }>('POST', '/conversations/groups', { body: { name, memberIds } }),
    openConversation: (userId: string) => request<{ id: string; request?: MessageRequestRole }>('POST', '/conversations', { body: { userId } }),
    messages: (conversationId: string, options: { before?: string; limit?: number } = {}) => {
      const params: string[] = [];
      if (options.before !== undefined) params.push(`before=${id(options.before)}`);
      if (options.limit !== undefined) params.push(`limit=${options.limit}`);
      return request<ChatView>('GET', `/conversations/${id(conversationId)}/messages${params.length > 0 ? `?${params.join('&')}` : ''}`);
    },
    sendText: (conversationId: string, body: string, replyToId?: string) =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { body, ...(replyToId ? { replyToId } : {}) } }),
    sendAudio: (conversationId: string, audio: string, audioMs: number, replyToId?: string) =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { audio, audioMs, ...(replyToId ? { replyToId } : {}) } }),
    /** Foto ou vídeo: o arquivo vai cru no corpo (sem base64), com o tipo no Content-Type. */
    sendMedia: async (conversationId: string, file: Blob, replyToId?: string): Promise<ChatMessage> => {
      const token = deps.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': file.type };
      if (token !== undefined) headers['Authorization'] = t('Bearer {token}', { token });
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/conversations/${id(conversationId)}/media${replyToId ? `?replyTo=${id(replyToId)}` : ''}`, { method: 'POST', headers, body: file });
      } catch {
        throw networkError();
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (response.ok) return payload as ChatMessage;
      const error = errorFromResponse(response.status, payload, response.headers.get('Retry-After'));
      // Só derruba a sessão se o token recusado ainda é o atual (outra chamada pode já ter trocado por um novo).
      if (error.code === 'UNAUTHORIZED' && token !== undefined && token === deps.getToken()) deps.onUnauthorized();
      throw error;
    },
    /** Documento (PDF, Word...): o arquivo vai cru no corpo, com o tipo no Content-Type e o nome em `?nome=`. */
    sendFile: async (conversationId: string, file: Blob, name: string, type: string, replyToId?: string): Promise<ChatMessage> => {
      const token = deps.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': type };
      if (token !== undefined) headers['Authorization'] = t('Bearer {token}', { token });
      const query = new URLSearchParams({ nome: name, ...(replyToId ? { replyTo: replyToId } : {}) });
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/conversations/${id(conversationId)}/files?${query.toString()}`, { method: 'POST', headers, body: file });
      } catch {
        throw networkError();
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        payload = undefined;
      }
      if (response.ok) return payload as ChatMessage;
      const error = errorFromResponse(response.status, payload, response.headers.get('Retry-After'));
      if (error.code === 'UNAUTHORIZED' && token !== undefined && token === deps.getToken()) deps.onUnauthorized();
      throw error;
    },
    /** Baixa a foto ou o vídeo de uma mensagem (a rota exige o token, então não dá para usar <img src>). */
    messageMedia: async (conversationId: string, messageId: string): Promise<Blob> => {
      const token = deps.getToken();
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/conversations/${id(conversationId)}/messages/${id(messageId)}/media`, { method: 'GET', headers: token !== undefined ? { Authorization: t('Bearer {token}', { token }) } : {} });
      } catch {
        throw networkError();
      }
      if (!response.ok) throw errorFromResponse(response.status, undefined, response.headers.get('Retry-After'));
      return response.blob();
    },
    /** Reage com um emoji; o mesmo emoji de novo (ou `null`) tira a reação. */
    reactMessage: (conversationId: string, messageId: string, emoji: string | null) =>
      request<{ reactions: ChatReaction[] }>('PUT', `/conversations/${id(conversationId)}/messages/${id(messageId)}/reaction`, { body: { emoji } }),
    /** Apaga a própria mensagem para todos. */
    deleteMessage: (conversationId: string, messageId: string) => request<ChatMessage>('DELETE', `/conversations/${id(conversationId)}/messages/${id(messageId)}`),
    /** Fixar no topo, silenciar os avisos e a cor da conversa (só para você). */
    setChatPrefs: (conversationId: string, prefs: { pinned?: boolean; muted?: boolean; color?: string | null }) =>
      request<{ pinned: boolean; muted: boolean; color: string | null }>('PUT', `/conversations/${id(conversationId)}/preferences`, { body: prefs }),
    /** Sinal de "digitando…". */
    sendTyping: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/typing`),
    /** Baixa o áudio de uma mensagem de voz (a rota exige o token, então não dá para usar <audio src>). */
    messageAudio: async (conversationId: string, messageId: string): Promise<Blob> => {
      const token = deps.getToken();
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/conversations/${id(conversationId)}/messages/${id(messageId)}/audio`, { method: 'GET', headers: token !== undefined ? { Authorization: t('Bearer {token}', { token }) } : {} });
      } catch {
        throw networkError();
      }
      if (!response.ok) throw errorFromResponse(response.status, undefined, response.headers.get('Retry-After'));
      return response.blob();
    },
    /** Avisa que você ouviu a mensagem de voz (quem enviou vê o "ouvido"). */
    markAudioPlayed: (conversationId: string, messageId: string) => request<{ played: true }>('POST', `/conversations/${id(conversationId)}/messages/${id(messageId)}/audio/played`),
    sendSuggestion: (conversationId: string, suggestion: SuggestionCard) =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { suggestion } }),
    respondSuggestion: (conversationId: string, messageId: string, action: 'accept' | 'decline' | 'cancel' | 'withdraw') =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages/${id(messageId)}/respond`, { body: { action } }),
    /** Endereço completo de um recurso da API (a foto do lugar), a partir do caminho que ela devolveu. */
    assetUrl: (path: string) => `${deps.baseUrl}${path}`,
    clearConversation: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/clear`),
    reportConversation: (conversationId: string, reason: ReportReason, details?: string) => request<{ reported: true }>('POST', `/conversations/${id(conversationId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    shared: (conversationId: string) => request<SharedView>('GET', `/conversations/${id(conversationId)}/shared`),
    group: (conversationId: string) => request<GroupDetails>('GET', `/conversations/${id(conversationId)}/group`),
    deleteGroup: (conversationId: string) => request<{ deleted: true }>('DELETE', `/conversations/${id(conversationId)}/group`),
    leaveGroup: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/leave`),
    setGroupAdmin: (conversationId: string, userId: string, admin: boolean) =>
      request<{ role: 'ADMIN' | 'MEMBER' }>('PUT', `/conversations/${id(conversationId)}/members/${id(userId)}/admin`, { body: { admin } }),
    addGroupMembers: (conversationId: string, userIds: string[]) => request<{ added: number }>('POST', `/conversations/${id(conversationId)}/members`, { body: { userIds } }),
    removeMember: (conversationId: string, userId: string) => request<{ ok: true }>('DELETE', `/conversations/${id(conversationId)}/members/${id(userId)}`),
    renameGroup: (conversationId: string, name: string) => request<{ name: string }>('PUT', `/conversations/${id(conversationId)}/group/name`, { body: { name } }),
    setGroupPhoto: (conversationId: string, image: string | null) => request<{ imageUrl: string | null }>('PUT', `/conversations/${id(conversationId)}/group/photo`, { body: { image } }),
    markRead: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/read`),

    // Encontros
    createMeetup: (input: { eventId: string; guestIds: string[]; name?: string }) => request<MeetupView>('POST', '/meetups', { body: input }),
    meetup: (meetupId: string) => request<MeetupView>('GET', `/meetups/${id(meetupId)}`),
    inviteMeetup: (meetupId: string, guestIds: string[]) => request<MeetupView>('POST', `/meetups/${id(meetupId)}/invite`, { body: { guestIds } }),
    renameMeetup: (meetupId: string, title: string) => request<MeetupView>('PATCH', `/meetups/${id(meetupId)}`, { body: { title } }),
    cancelMeetup: (meetupId: string) => request<MeetupView>('POST', `/meetups/${id(meetupId)}/cancel`),
    datePolls: () => request<{ items: PollSummary[] }>('GET', '/date-polls'),
    conversationPolls: (conversationId: string) => request<{ items: PollSummary[] }>('GET', `/date-polls/conversation/${id(conversationId)}`),
    createPoll: (input: PollInput) => request<PollView>('POST', '/date-polls', { body: input }),
    updatePoll: (pollId: string, input: { title?: string; rangeStart?: string; rangeEnd?: string; confirmationPolicy?: 'MAJORITY' | 'UNANIMITY' | 'MANUAL' }) => request<PollView>('PATCH', `/date-polls/${id(pollId)}`, { body: input }),
    poll: (pollId: string) => request<PollView>('GET', `/date-polls/${id(pollId)}`),
    votePoll: (pollId: string, status: VoteStatus | 'CLEAR', dates: string[]) => request<PollView>('POST', `/date-polls/${id(pollId)}/votes`, { body: { status, dates } }),
    finishPoll: (pollId: string, finished: boolean) => request<PollView>('POST', `/date-polls/${id(pollId)}/finish`, { body: { finished } }),
    closePoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/close`),
    proposePoll: (pollId: string, date: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/propose`, { body: { date } }),
    confirmBestPoll: (pollId: string, date?: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/confirm-best`, { body: date ? { date } : {} }),
    withdrawPoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/withdraw`),
    respondPoll: (pollId: string, status: ConfirmationAnswer) => request<PollView>('POST', `/date-polls/${id(pollId)}/respond`, { body: { status } }),
    finalizePoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/finalize`),
    cancelPoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/cancel`),
    respondMeetup: (meetupId: string, action: 'accept' | 'decline') => request<MeetupView>('POST', `/meetups/${id(meetupId)}/respond`, { body: { action } }),

    /** Registro de atividades (o que eu fiz), do mais recente ao mais antigo. `cursor`: o `nextCursor` da página anterior. */
    myActivity: (kind: ActivityFilter = 'ALL', cursor?: string | null) => request<ActivityPage>('GET', `/me/activity${toQuery({ kind: kind === 'ALL' ? undefined : kind, cursor: cursor ?? undefined })}`),

    // Avisos
    notifications: (category: NotificationCategory = 'all') => request<NotificationList>('GET', `/notifications${toQuery({ category: category === 'all' ? undefined : category })}`),
    unreadNotifications: () => request<{ unread: number; latestUnreadAt: string | null }>('GET', '/notifications/unread'),
    /** Um aviso (id), os selecionados (lista de ids) ou todos (sem argumento). */
    markNotificationsRead: (notificationId?: string | string[]) => request<{ unread: number }>('POST', '/notifications/read', { body: Array.isArray(notificationId) ? { ids: notificationId } : notificationId ? { id: notificationId } : {} }),
    /** Manda um aviso de teste para os aparelhos da própria pessoa. */
    pushTest: () => request<PushTestResult>('POST', '/notifications/push/test'),
    pushKey: () => request<{ publicKey: string | null; native?: boolean }>('GET', '/notifications/push-key'),
    pushSubscribe: (input: { endpoint: string; keys?: { p256dh: string; auth: string }; reply?: boolean }) => request<{ ok: true }>('POST', '/notifications/push', { body: input }),
    pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('POST', '/notifications/push/remove', { body: { endpoint } }),

    // Álbuns dos encontros
    albums: () => request<{ items: AlbumSummary[] }>('GET', '/albums'),
    album: (albumId: string) => request<AlbumDetail>('GET', `/albums/${id(albumId)}`),
    addAlbumPhoto: (albumId: string, image: string) => request<AlbumPhoto>('POST', `/albums/${id(albumId)}/photos`, { body: { image } }),
    deleteAlbumPhoto: (albumId: string, photoId: string) => request<{ ok: true }>('DELETE', `/albums/${id(albumId)}/photos/${id(photoId)}`),
    postAlbumPhoto: (albumId: string, photoId: string, caption?: string) => request<{ id: string }>('POST', `/albums/${id(albumId)}/photos/${id(photoId)}/post`, { body: caption === undefined || caption.trim() === '' ? {} : { caption } }),
    /** Baixa a foto do álbum (a rota exige o token, então não dá para usar <img src>). */
    albumPhoto: async (albumId: string, photoId: string): Promise<Blob> => {
      const token = deps.getToken();
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/albums/${id(albumId)}/photos/${id(photoId)}`, { method: 'GET', headers: token !== undefined ? { Authorization: t('Bearer {token}', { token }) } : {} });
      } catch {
        throw networkError();
      }
      if (!response.ok) throw errorFromResponse(response.status, undefined, response.headers.get('Retry-After'));
      return response.blob();
    },

    // Bloqueios
    block: (userId: string) => request<{ ok: true }>('POST', `/users/${id(userId)}/block`),
    unblock: (userId: string) => request<{ removed: boolean }>('DELETE', `/users/${id(userId)}/block`),
    blocks: () => request<PublicProfile[]>('GET', '/me/blocks'),
  };
}

export type Api = ReturnType<typeof createApi>;
