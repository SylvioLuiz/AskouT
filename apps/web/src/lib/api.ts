import { errorFromResponse, networkError } from './errors.ts';
import type { ConfirmationAnswer, PollInput, PollSummary, PollView, VoteStatus } from './date-poll.ts';
import type { DwellEntry } from './dwell.ts';
import type { SuggestedPerson } from './suggested-people.ts';
import type {
  BoostPricing,
  Recommendations,
  BoostView,
  MatchReach,
  RegionView,
  ClaimableVenue,
  ExploreEvent,
  MyVenues,
  VenueClaim,
  VenueEvent,
  VenueEventBody,
  VenueProfile,
  VenueRating,
  VenueProfileBody,
  VenuePanel,
  AuthResult,
  PasswordResetStarted,
  AvailableFriend,
  ChatMessage,
  ChatReaction,
  ChatView,
  ConversationItem,
  SuggestionCard,
  Suggestions,
  FlashInvite,
  FlashInvites,
  FlashMatch,
  FlashStatus,
  FlashVisibility,
  SharedView,
  Slot,
  SlotInput,
  ConnectionsPage,
  EventKind,
  EventPage,
  NotificationMute,
  EventStoryGroup,
  EventPost,
  GroupDetails,
  GoingEvent,
  MeetupView,
  NotificationList,
  PostedEventsPage,
  PostComment,
  PostCommentsPage,
  PostEdit,
  PostImageInput,
  ReportReason,
  PostsPage,
  PostView,
  ExploreParams,
  ExploreResult,
  ExplorePlace,
  PageRequest,
  Profile,
  ProfilePatch,
  ProfileView,
  PublicProfile,
  SessionUser,
  SignupInput,
  AgeStatus,
  SignupStarted,
  SocialNeedsProfile,
  SocialProvider,
  SocialProviderId,
} from './types.ts';

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

export function createApi(deps: ApiDeps) {
  async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false;
    const token = useAuth ? deps.getToken() : undefined;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
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
    if (error.code === 'UNAUTHORIZED' && token !== undefined) deps.onUnauthorized();
    throw error;
  }

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
      request<AuthResult>('POST', '/auth/password-reset/confirm', { body: { identifier, code, password }, auth: false }),
    login: (identifier: string, password: string) =>
      request<AuthResult>('POST', '/auth/login', { body: { identifier, password }, auth: false }),
    socialProviders: () => request<{ items: SocialProvider[] }>('GET', '/auth/providers', { auth: false }),
    socialLogin: (input: { provider: SocialProviderId; idToken: string; username?: string; displayName?: string; birthDate?: string; acceptTerms?: boolean }) =>
      request<AuthResult | SocialNeedsProfile>('POST', '/auth/social', { body: input, auth: false }),
    me: () => request<SessionUser>('GET', '/auth/me'),

    // Perfis
    searchProfiles: (query: string, limit?: number) =>
      request<PublicProfile[]>(
        'GET',
        `/profiles/search?q=${id(query)}${limit !== undefined ? `&limit=${limit}` : ''}`,
      ),
    getProfile: (username: string) => request<ProfileView>('GET', `/profiles/${id(username)}`),
    setProfilePhoto: (image: string | null) => request<Profile>('PUT', '/profiles/me/photo', { body: { image } }),
    profileEvents: (username: string, page?: PageRequest) => request<PostedEventsPage>('GET', `/profiles/${id(username)}/events${pageQuery(page)}`),
    postEvent: (eventId: string) => request<{ posted: true }>('POST', `/events/${id(eventId)}/post`),
    unpostEvent: (eventId: string) => request<{ posted: false }>('DELETE', `/events/${id(eventId)}/post`),
    sendEvent: (conversationId: string, eventId: string) => request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { eventId } }),
    createPost: (input: { images: PostImageInput[]; caption?: string; placeName?: string; placeAddress?: string; tagUserIds?: string[]; event?: { title: string; kind?: EventKind; startsAt: string | null; endsAt?: string | null }; datePollId?: string }) => request<PostView>('POST', '/posts', { body: input }),
    post: (postId: string) => request<PostView>('GET', `/posts/${id(postId)}`),
    /** Anexa o vídeo ao item de foto que serve de capa: o arquivo vai cru no corpo, com o tipo no Content-Type. */
    attachPostVideo: async (postId: string, imageId: string, file: Blob, onProgress?: (sent: number, total: number) => void): Promise<PostView> => {
      const token = deps.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': file.type };
      if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
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
      if (error.code === 'UNAUTHORIZED' && token !== undefined) deps.onUnauthorized();
      throw error;
    },
    deletePost: (postId: string) => request<{ deleted: true }>('DELETE', `/posts/${id(postId)}`),
    pendingTags: (page?: PageRequest) => request<PostsPage>('GET', `/posts/pending-tags${pageQuery(page)}`),
    respondTag: (postId: string, action: 'accept' | 'decline') => request<{ status: 'ACCEPTED' | 'DECLINED' }>('POST', `/posts/${id(postId)}/tag`, { body: { action } }),
    likePost: (postId: string) => request<{ liked: true; likeCount: number }>('POST', `/posts/${id(postId)}/like`),
    unlikePost: (postId: string) => request<{ liked: false; likeCount: number }>('DELETE', `/posts/${id(postId)}/like`),
    postComments: (postId: string, page?: PageRequest) => request<PostCommentsPage>('GET', `/posts/${id(postId)}/comments${pageQuery(page)}`),
    addComment: (postId: string, body: string) => request<PostComment>('POST', `/posts/${id(postId)}/comments`, { body: { body } }),
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
    userPosts: (username: string, page?: PageRequest, kind?: 'event' | 'post') => request<PostsPage>('GET', `/profiles/${id(username)}/posts${pageQuery(page)}${kind ? `${page ? '&' : '?'}kind=${kind}` : ''}`),
    myMeetups: () => request<{ items: MeetupView[] }>('GET', '/meetups'),
    myGoingEvents: () => request<{ items: GoingEvent[] }>('GET', '/me/events/going'),
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
    followRequests: (page?: PageRequest) =>
      request<ConnectionsPage>('GET', `/me/follow-requests${pageQuery(page)}`),
    approveRequest: (userId: string) =>
      request<{ isFriend: boolean }>('POST', `/me/follow-requests/${id(userId)}/approve`),
    rejectRequest: (userId: string) => request<{ ok: true }>('POST', `/me/follow-requests/${id(userId)}/reject`),
    removeFollower: (userId: string) => request<{ ok: true }>('DELETE', `/me/followers/${id(userId)}`),
    contactMatches: (hashes: string[]) => request<{ items: PublicProfile[] }>('POST', '/me/contact-matches', { body: { hashes } }),
    suggestedPeople: () => request<{ items: SuggestedPerson[]; followingCount: number }>('GET', '/me/suggested-people'),
    friends: () => request<PublicProfile[]>('GET', '/me/friends'),

    // Agenda
    mySlots: (from: string, to: string) =>
      request<Slot[]>('GET', `/me/availability?from=${id(from)}&to=${id(to)}`),
    addSlot: (input: SlotInput) => request<Slot>('POST', '/me/availability', { body: input }),
    removeSlot: (slotId: string) => request<{ removed: boolean }>('DELETE', `/me/availability/${id(slotId)}`),

    // Flash
    flashStatus: () => request<FlashStatus>('GET', '/me/flash'),
    flashOn: (minutes: number, note: string) =>
      request<FlashStatus>('POST', '/me/flash', { body: note === '' ? { minutes } : { minutes, note } }),
    flashOff: () => request<{ ended: boolean }>('DELETE', '/me/flash'),
    flashActive: () => request<{ userIds: string[] }>('GET', '/flash/active'),
    flashVisibility: (userId: string) => request<FlashVisibility>('GET', `/flash/visibility/${id(userId)}`),
    setFlashVisibility: (userId: string, body: Partial<FlashVisibility>) => request<FlashVisibility>('PUT', `/flash/visibility/${id(userId)}`, { body }),
    flashAvailable: () => request<{ items: AvailableFriend[] }>('GET', '/flash/available'),
    flashInvites: () => request<FlashInvites>('GET', '/flash/invites'),
    flashInvite: (userId: string) => request<FlashInvite>('POST', '/flash/invites', { body: { userId } }),
    flashRespond: (inviteId: string, action: 'accept' | 'decline') =>
      request<{ status: 'ACCEPTED' | 'DECLINED'; conversationId: string | null }>('POST', `/flash/invites/${id(inviteId)}/respond`, { body: { action } }),
    flashEnd: (inviteId: string) => request<{ ended: boolean }>('DELETE', `/flash/invites/${id(inviteId)}`),
    flashMatch: (inviteId: string) => request<FlashMatch>('GET', `/flash/matches/${id(inviteId)}`),
    flashShareLocation: (inviteId: string, position: { lat: number; lng: number; accuracyM?: number }) =>
      request<{ ok: true }>('PUT', `/flash/matches/${id(inviteId)}/location`, { body: position }),

    flashSuggestions: (inviteId: string) => request<Suggestions>('GET', `/flash/matches/${id(inviteId)}/suggestions`),

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
      const text = query.toString();
      return request<ExploreResult>('GET', `/explore${text ? `?${text}` : ''}`);
    },
    /** Locais perto (AskouT + Google/OSM) para os pins do mapa do Explorar. */
    explorePlaces: (params: { lat: number; lng: number; radiusKm?: number }) => {
      const query = new URLSearchParams({ lat: String(params.lat), lng: String(params.lng) });
      if (params.radiusKm !== undefined) query.set('radiusKm', String(params.radiusKm));
      return request<{ places: ExplorePlace[]; placesAvailable: boolean }>('GET', `/explore/places?${query.toString()}`);
    },
    recommendations: (personalize: boolean) => request<Recommendations>('GET', `/me/recommendations?personalize=${personalize ? 'true' : 'false'}`),
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
    exportMyData: () => request<{ filename: string; data: Record<string, unknown> }>('GET', '/me/export'),
    /** Apaga a minha conta de vez. Conta que entra com Google/Apple não manda senha. */
    deleteMyAccount: (input: { username: string; password?: string }) => request<{ deleted: true }>('DELETE', '/me', { body: input }),
    clearRegion: () => request<{ removed: boolean }>('DELETE', '/me/region'),
    cancelBoost: (boostId: string) => request<BoostView>('POST', `/me/boosts/${id(boostId)}/cancel`),
    simulateBoostPayment: (boostId: string) => request<BoostView>('POST', `/me/boosts/${id(boostId)}/simulate-payment`),
    confirmStorePurchase: (boostId: string, receipt: string) => request<BoostView>('POST', `/me/boosts/${id(boostId)}/store-purchase`, { body: { receipt } }),
    sponsoredEvents: () => request<{ events: ExploreEvent[] }>('GET', '/explore/sponsored'),
    followedEvents: () => request<{ events: ExploreEvent[] }>('GET', '/explore/followed-events'),
    eventPage: (eventId: string, position?: { lat: number; lng: number }) =>
      request<EventPage>('GET', `/events/${id(eventId)}${position ? `?lat=${position.lat}&lng=${position.lng}` : ''}`),
    eventStories: (eventId: string) => request<{ groups: EventStoryGroup[] }>('GET', `/events/${id(eventId)}/stories`),
    createEventStory: async (eventId: string, file: Blob): Promise<EventStoryGroup> => {
      const token = deps.getToken();
      const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': file.type };
      if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/events/${id(eventId)}/stories`, { method: 'POST', headers, body: file });
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
      if (error.code === 'UNAUTHORIZED' && token !== undefined) deps.onUnauthorized();
      throw error;
    },
    deleteEventStory: (eventId: string, storyId: string) => request<{ deleted: true }>('DELETE', `/events/${id(eventId)}/stories/${id(storyId)}`),
    reportEventStory: (eventId: string, storyId: string, reason: ReportReason, details?: string) =>
      request<{ reported: true }>('POST', `/events/${id(eventId)}/stories/${id(storyId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    storyMediaUrl: (storyId: string) => `${deps.baseUrl}/stories/media/${id(storyId)}`,
    eventGo: (eventId: string) => request<EventPage>('POST', `/events/${id(eventId)}/going`),
    eventCancel: (eventId: string) => request<EventPage>('DELETE', `/events/${id(eventId)}/going`),
    eventPostsPublic: (eventId: string, value: boolean) => request<EventPage>('PUT', `/events/${id(eventId)}/posts-public`, { body: { public: value } }),
    createEventPost: (eventId: string, input: { caption: string; image?: string }) => request<EventPost>('POST', `/events/${id(eventId)}/posts`, { body: input }),
    deleteEventPost: (eventId: string, postId: string) => request<{ deleted: true }>('DELETE', `/events/${id(eventId)}/posts/${id(postId)}`),

    // Locais (painel do local)
    myVenues: () => request<MyVenues>('GET', '/me/venues'),
    claimableVenues: (q: string) => request<ClaimableVenue[]>('GET', `/venues/claimable?q=${encodeURIComponent(q)}`),
    claimVenue: (venueId: string, input: { document: string; note?: string }) => request<VenueClaim>('POST', `/venues/${id(venueId)}/claims`, { body: input }),
    cancelClaim: (claimId: string) => request<{ cancelled: true }>('DELETE', `/venue-claims/${id(claimId)}`),
    venuePanel: (venueId: string) => request<VenuePanel>('GET', `/me/venues/${id(venueId)}`),
    createVenueEvent: (venueId: string, body: VenueEventBody) => request<VenueEvent>('POST', `/me/venues/${id(venueId)}/events`, { body }),
    updateVenueEvent: (venueId: string, eventId: string, body: VenueEventBody) => request<VenueEvent>('PUT', `/me/venues/${id(venueId)}/events/${id(eventId)}`, { body }),
    venueProfile: (venueId: string) => request<VenueProfile>('GET', `/venues/${id(venueId)}/profile`),
    updateVenueProfile: (venueId: string, body: VenueProfileBody) => request<VenueProfile>('PUT', `/me/venues/${id(venueId)}/profile`, { body }),
    followVenue: (venueId: string) => request<{ following: true; followerCount: number }>('POST', `/venues/${id(venueId)}/follow`),
    rateVenue: (venueId: string, stars: number) => request<VenueRating>('PUT', `/venues/${id(venueId)}/rating`, { body: { stars } }),
    clearVenueRating: (venueId: string) => request<VenueRating>('DELETE', `/venues/${id(venueId)}/rating`),
    unfollowVenue: (venueId: string) => request<{ following: false; followerCount: number }>('DELETE', `/venues/${id(venueId)}/follow`),
    venuePosts: (venueId: string, page?: PageRequest) => request<PostsPage>('GET', `/venues/${id(venueId)}/posts${pageQuery(page)}`),
    createVenuePost: (venueId: string, input: { images: string[]; caption?: string }) => request<PostView>('POST', `/me/venues/${id(venueId)}/posts`, { body: input }),
    openExternalVenue: (input: { key: string; lat: number; lng: number }) => request<{ venueId: string }>('POST', '/venues/external', { body: input }),
    deleteVenueEvent: (venueId: string, eventId: string) => request<{ deleted: true }>('DELETE', `/me/venues/${id(venueId)}/events/${id(eventId)}`),

    // Conversas
    conversations: () => request<{ items: ConversationItem[] }>('GET', '/conversations'),
    createGroup: (name: string, memberIds: string[]) => request<{ id: string }>('POST', '/conversations/groups', { body: { name, memberIds } }),
    openConversation: (userId: string) => request<{ id: string }>('POST', '/conversations', { body: { userId } }),
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
      if (token !== undefined) headers['Authorization'] = `Bearer ${token}`;
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
      if (error.code === 'UNAUTHORIZED' && token !== undefined) deps.onUnauthorized();
      throw error;
    },
    /** Baixa a foto ou o vídeo de uma mensagem (a rota exige o token, então não dá para usar <img src>). */
    messageMedia: async (conversationId: string, messageId: string): Promise<Blob> => {
      const token = deps.getToken();
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/conversations/${id(conversationId)}/messages/${id(messageId)}/media`, { method: 'GET', headers: token !== undefined ? { Authorization: `Bearer ${token}` } : {} });
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
    /** Fixar no topo e silenciar os avisos (só para você). */
    setChatPrefs: (conversationId: string, prefs: { pinned?: boolean; muted?: boolean }) =>
      request<{ pinned: boolean; muted: boolean }>('PUT', `/conversations/${id(conversationId)}/preferences`, { body: prefs }),
    /** Sinal de "digitando…". */
    sendTyping: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/typing`),
    /** Baixa o áudio de uma mensagem de voz (a rota exige o token, então não dá para usar <audio src>). */
    messageAudio: async (conversationId: string, messageId: string): Promise<Blob> => {
      const token = deps.getToken();
      let response;
      try {
        response = await deps.fetch(`${deps.baseUrl}/conversations/${id(conversationId)}/messages/${id(messageId)}/audio`, { method: 'GET', headers: token !== undefined ? { Authorization: `Bearer ${token}` } : {} });
      } catch {
        throw networkError();
      }
      if (!response.ok) throw errorFromResponse(response.status, undefined, response.headers.get('Retry-After'));
      return response.blob();
    },
    sendSuggestion: (conversationId: string, suggestion: SuggestionCard) =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { suggestion } }),
    respondSuggestion: (conversationId: string, messageId: string, action: 'accept' | 'decline') =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages/${id(messageId)}/respond`, { body: { action } }),
    /** Endereço completo de um recurso da API (a foto do lugar), a partir do caminho que ela devolveu. */
    assetUrl: (path: string) => `${deps.baseUrl}${path}`,
    clearConversation: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/clear`),
    reportConversation: (conversationId: string, reason: ReportReason, details?: string) => request<{ reported: true }>('POST', `/conversations/${id(conversationId)}/report`, { body: { reason, ...(details ? { details } : {}) } }),
    shared: (conversationId: string) => request<SharedView>('GET', `/conversations/${id(conversationId)}/shared`),
    group: (conversationId: string) => request<GroupDetails>('GET', `/conversations/${id(conversationId)}/group`),
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
    poll: (pollId: string) => request<PollView>('GET', `/date-polls/${id(pollId)}`),
    votePoll: (pollId: string, status: VoteStatus | 'CLEAR', dates: string[]) => request<PollView>('POST', `/date-polls/${id(pollId)}/votes`, { body: { status, dates } }),
    finishPoll: (pollId: string, finished: boolean) => request<PollView>('POST', `/date-polls/${id(pollId)}/finish`, { body: { finished } }),
    closePoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/close`),
    proposePoll: (pollId: string, date: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/propose`, { body: { date } }),
    withdrawPoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/withdraw`),
    respondPoll: (pollId: string, status: ConfirmationAnswer) => request<PollView>('POST', `/date-polls/${id(pollId)}/respond`, { body: { status } }),
    finalizePoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/finalize`),
    cancelPoll: (pollId: string) => request<PollView>('POST', `/date-polls/${id(pollId)}/cancel`),
    respondMeetup: (meetupId: string, action: 'accept' | 'decline') => request<MeetupView>('POST', `/meetups/${id(meetupId)}/respond`, { body: { action } }),

    // Avisos
    notifications: () => request<NotificationList>('GET', '/notifications'),
    unreadNotifications: () => request<{ unread: number; latestUnreadAt: string | null }>('GET', '/notifications/unread'),
    markNotificationsRead: (notificationId?: string) => request<{ unread: number }>('POST', '/notifications/read', { body: notificationId ? { id: notificationId } : {} }),
    pushKey: () => request<{ publicKey: string | null }>('GET', '/notifications/push-key'),
    pushSubscribe: (input: { endpoint: string; keys: { p256dh: string; auth: string } }) => request<{ ok: true }>('POST', '/notifications/push', { body: input }),
    pushUnsubscribe: (endpoint: string) => request<{ ok: true }>('POST', '/notifications/push/remove', { body: { endpoint } }),

    // Bloqueios
    block: (userId: string) => request<{ ok: true }>('POST', `/users/${id(userId)}/block`),
    unblock: (userId: string) => request<{ removed: boolean }>('DELETE', `/users/${id(userId)}/block`),
    blocks: () => request<PublicProfile[]>('GET', '/me/blocks'),
  };
}

export type Api = ReturnType<typeof createApi>;
