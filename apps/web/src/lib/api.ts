import { errorFromResponse, networkError } from './errors.ts';
import type {
  AuthResult,
  AvailableFriend,
  ChatMessage,
  ChatView,
  ConversationItem,
  SuggestionCard,
  Suggestions,
  FlashInvite,
  FlashInvites,
  FlashMatch,
  FlashStatus,
  BestDatesInput,
  Compatibility,
  FriendAvailability,
  Slot,
  SlotInput,
  ConnectionsPage,
  ExploreEvent,
  GroupDetails,
  MeetupView,
  ExploreParams,
  ExploreResult,
  PageRequest,
  Profile,
  ProfilePatch,
  ProfileView,
  PublicProfile,
  SessionUser,
  SignupInput,
  SignupStarted,
} from './types.ts';

/** O mínimo de `fetch` que o cliente usa (facilita testar sem navegador). */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
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
    login: (identifier: string, password: string) =>
      request<AuthResult>('POST', '/auth/login', { body: { identifier, password }, auth: false }),
    me: () => request<SessionUser>('GET', '/auth/me'),

    // Perfis
    searchProfiles: (query: string, limit?: number) =>
      request<PublicProfile[]>(
        'GET',
        `/profiles/search?q=${id(query)}${limit !== undefined ? `&limit=${limit}` : ''}`,
      ),
    getProfile: (username: string) => request<ProfileView>('GET', `/profiles/${id(username)}`),
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
    friends: () => request<PublicProfile[]>('GET', '/me/friends'),

    // Agenda
    mySlots: (from: string, to: string) =>
      request<Slot[]>('GET', `/me/availability?from=${id(from)}&to=${id(to)}`),
    addSlot: (input: SlotInput) => request<Slot>('POST', '/me/availability', { body: input }),
    removeSlot: (slotId: string) => request<{ removed: boolean }>('DELETE', `/me/availability/${id(slotId)}`),
    friendSlots: (userId: string, from: string, to: string) =>
      request<FriendAvailability>('GET', `/users/${id(userId)}/availability?from=${id(from)}&to=${id(to)}`),
    compatibility: (friendIds: string[], start: string, end: string) =>
      request<Compatibility>('POST', '/compatibility', { body: { friendIds, start, end } }),
    bestDates: (input: BestDatesInput) =>
      request<{ items: Compatibility[] }>('POST', '/compatibility/best-dates', { body: input }),

    // Flash
    flashStatus: () => request<FlashStatus>('GET', '/me/flash'),
    flashOn: (hours: number, note: string) =>
      request<FlashStatus>('POST', '/me/flash', { body: note === '' ? { hours } : { hours, note } }),
    flashOff: () => request<{ ended: boolean }>('DELETE', '/me/flash'),
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
      const text = query.toString();
      return request<ExploreResult>('GET', `/explore${text ? `?${text}` : ''}`);
    },
    exploreEvent: (eventId: string, position?: { lat: number; lng: number }) =>
      request<ExploreEvent>('GET', `/events/${id(eventId)}${position ? `?lat=${position.lat}&lng=${position.lng}` : ''}`),

    // Conversas
    conversations: () => request<{ items: ConversationItem[] }>('GET', '/conversations'),
    openConversation: (userId: string) => request<{ id: string }>('POST', '/conversations', { body: { userId } }),
    messages: (conversationId: string, options: { before?: string; limit?: number } = {}) => {
      const params: string[] = [];
      if (options.before !== undefined) params.push(`before=${id(options.before)}`);
      if (options.limit !== undefined) params.push(`limit=${options.limit}`);
      return request<ChatView>('GET', `/conversations/${id(conversationId)}/messages${params.length > 0 ? `?${params.join('&')}` : ''}`);
    },
    sendText: (conversationId: string, body: string) =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { body } }),
    sendSuggestion: (conversationId: string, suggestion: SuggestionCard) =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages`, { body: { suggestion } }),
    respondSuggestion: (conversationId: string, messageId: string, action: 'accept' | 'decline') =>
      request<ChatMessage>('POST', `/conversations/${id(conversationId)}/messages/${id(messageId)}/respond`, { body: { action } }),
    /** Endereço completo de um recurso da API (a foto do lugar), a partir do caminho que ela devolveu. */
    assetUrl: (path: string) => `${deps.baseUrl}${path}`,
    group: (conversationId: string) => request<GroupDetails>('GET', `/conversations/${id(conversationId)}/group`),
    leaveGroup: (conversationId: string) => request<{ ok: true }>('POST', `/conversations/${id(conversationId)}/leave`),
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
    respondMeetup: (meetupId: string, action: 'accept' | 'decline') => request<MeetupView>('POST', `/meetups/${id(meetupId)}/respond`, { body: { action } }),

    // Bloqueios
    block: (userId: string) => request<{ ok: true }>('POST', `/users/${id(userId)}/block`),
    unblock: (userId: string) => request<{ removed: boolean }>('DELETE', `/users/${id(userId)}/block`),
    blocks: () => request<PublicProfile[]>('GET', '/me/blocks'),
  };
}

export type Api = ReturnType<typeof createApi>;
