import { getPageSize } from './page-size.ts';
import { query } from './labels.ts';
import type {
  AuditRow, AuthResult, EventExtra, EventExtraInput, Taste, TasteInput, MfaChallenge, FeedCommentRow, FeedPostRow, FeedReportRow, PaymentsState, RecoExperimentState, RetentionReport, TopInviter, Claim, ClaimStatus, ConversationReportRow, UserReportRow, Page, PlaceEventRow, PostReportRow, PostRow, Resolution, StoryReportRow, VenueStoryReportRow, SessionUser, Stats, UserRow, UserStatus, VenueRow,
} from './types.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Em produção o portal fica em outro endereço que a API (VITE_API_URL); em desenvolvimento usa o proxy `/api`. */
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '/api').replace(/\/+$/, '');

const TOKEN_KEY = 'askout.admin.token';

/**
 * O token fica guardado no navegador (continua logado ao fechar e reabrir) e, se o navegador bloquear, na memória.
 * A sessão é renovada a cada abertura e só cai depois de muito tempo sem uso, troca de senha ou perda do acesso.
 */
let memoryToken: string | undefined;
export const session = {
  get(): string | undefined {
    try {
      return window.localStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token: string): void {
    memoryToken = token;
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* só na memória */
    }
  },
  clear(): void {
    memoryToken = undefined;
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nada */
    }
  },
};

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

function messageFor(status: number, body: unknown): { code: string; message: string } {
  const err = typeof body === 'object' && body !== null ? (body as { error?: { code?: unknown; message?: unknown } }).error : undefined;
  const code = typeof err?.code === 'string' ? err.code : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : 'INTERNAL';
  if (status >= 500) return { code, message: 'A API está com problemas agora. Tente de novo em instantes.' };
  const message = typeof err?.message === 'string' && err.message.trim() !== '' ? err.message : 'Algo deu errado. Tente de novo.';
  return { code, message };
}

async function send(method: string, path: string, body?: unknown, auth = true): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = auth ? session.get() : undefined;
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Não foi possível falar com a API. Confira se ela está rodando.');
  }
  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }
    const { code, message } = messageFor(response.status, payload);
    // Só derruba a sessão se o token recusado ainda é o atual (outra chamada pode já ter trocado por um novo).
    if (response.status === 401 && token && token === session.get()) onUnauthorized();
    throw new ApiError(response.status, code, message);
  }
  return response;
}

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const response = await send(method, path, body, auth);
  return (await response.json()) as T;
}

export const api = {
  login: (identifier: string, password: string) => request<AuthResult | MfaChallenge>('POST', '/admin/login', { identifier, password }, false),
  mfaVerify: (mfaToken: string, code: string) => request<AuthResult>('POST', '/admin/mfa/verify', { mfaToken, code }, false),
  socialProviders: () => request<{ items: { provider: string; clientId: string }[] }>('GET', '/auth/providers', undefined, false),
  appleLogin: (idToken: string) => request<AuthResult | MfaChallenge>('POST', '/admin/social', { provider: 'APPLE', idToken }, false),
  /** Os outros aparelhos saem; este recebe um token novo e continua logado. */
  changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
    const response = await send('POST', '/admin/password', { currentPassword, newPassword });
    const payload = (await response.json().catch(() => undefined)) as { token?: unknown } | undefined;
    if (typeof payload?.token === 'string') session.set(payload.token);
  },
  /** Renova o token: a sessão só expira depois de muito tempo sem abrir a gestão. */
  refreshSession: async (): Promise<void> => {
    const { token } = await request<{ token: string }>('POST', '/auth/refresh');
    session.set(token);
  },
  me: () => request<SessionUser>('GET', '/auth/me'),
  stats: () => request<Stats>('GET', '/admin/stats'),
  payments: () => request<PaymentsState>('GET', '/admin/payments'),
  setPayments: (enabled: boolean, note: string) => request<PaymentsState>('PUT', '/admin/payments', { enabled, note }),
  topInviters: (limit = 20) => request<TopInviter[]>('GET', `/admin/referrals/top${query({ limit })}`),
  recoExperiment: () => request<RecoExperimentState>('GET', '/admin/reco-experiment'),
  setRecoExperiment: (enabled: boolean, controlPercent: number, note: string) => request<RecoExperimentState>('PUT', '/admin/reco-experiment', { enabled, controlPercent, note }),
  retention: (days: number) => request<RetentionReport>('GET', `/admin/retention${query({ days })}`),

  claims: (status: ClaimStatus) => request<Claim[]>('GET', `/admin/claims${query({ status })}`),
  /** Baixa o documento com o token e devolve um endereço temporário para exibir. */
  async claimDocument(id: string): Promise<{ url: string; mime: string }> {
    const response = await send('GET', `/admin/claims/${encodeURIComponent(id)}/document`);
    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type };
  },
  reviewClaim: (id: string, decision: 'APPROVED' | 'REJECTED', note: string) => request<unknown>('POST', `/admin/claims/${encodeURIComponent(id)}/review`, { decision, note }),

  users: (p: { q: string; status?: UserStatus; offset: number }) => request<Page<UserRow>>('GET', `/admin/users${query({ q: p.q, status: p.status, offset: p.offset, limit: getPageSize() })}`),
  setUserBirthDate: (id: string, birthDate: string, note: string) => request<unknown>('PUT', `/admin/users/${encodeURIComponent(id)}/birth-date`, { birthDate, note }),
  setUserStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED', note: string) => request<unknown>('PUT', `/admin/users/${encodeURIComponent(id)}/status`, { status, note }),

  venues: (p: { q: string; offset: number }) => request<Page<VenueRow>>('GET', `/admin/venues${query({ ...p, limit: getPageSize() })}`),
  removeOwner: (venueId: string, note: string) => request<unknown>('DELETE', `/admin/venues/${encodeURIComponent(venueId)}/owner`, { note }),

  placeEvents: (p: { q: string; offset: number }) => request<Page<PlaceEventRow>>('GET', `/admin/place-events${query({ ...p, limit: getPageSize() })}`),
  deletePlaceEvent: (id: string, note: string) => request<unknown>('DELETE', `/admin/place-events/${encodeURIComponent(id)}`, { note }),

  posts: (p: { q: string; events: boolean; offset: number }) => request<Page<PostRow>>('GET', `/admin/posts${query({ ...p, limit: getPageSize() })}`),
  deletePost: (id: string, note: string) => request<unknown>('DELETE', `/admin/posts/${encodeURIComponent(id)}`, { note }),

  postReports: (p: { resolved: boolean; offset: number }) => request<Page<PostReportRow>>('GET', `/admin/reports/posts${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset, limit: getPageSize() })}`),
  conversationReports: (p: { resolved: boolean; offset: number }) => request<Page<ConversationReportRow>>('GET', `/admin/reports/conversations${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset, limit: getPageSize() })}`),
  storyReports: (p: { resolved: boolean; offset: number }) => request<Page<StoryReportRow>>('GET', `/admin/reports/stories${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset, limit: getPageSize() })}`),
  resolveStoryReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/stories/${encodeURIComponent(id)}/resolve`, { resolution, note }),
  deleteStory: (id: string, note: string) => request<unknown>('DELETE', `/admin/stories/${encodeURIComponent(id)}`, { note }),
  /** Baixa a mídia do story com o token e devolve um endereço temporário para exibir. */
  async storyMedia(id: string): Promise<{ url: string; mime: string }> {
    const response = await send('GET', `/admin/stories/${encodeURIComponent(id)}/media`);
    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type };
  },
  venueStoryReports: (p: { resolved: boolean; offset: number }) => request<Page<VenueStoryReportRow>>('GET', `/admin/reports/venue-stories${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset, limit: getPageSize() })}`),
  resolveVenueStoryReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/venue-stories/${encodeURIComponent(id)}/resolve`, { resolution, note }),
  deleteVenueStory: (id: string, note: string) => request<unknown>('DELETE', `/admin/venue-stories/${encodeURIComponent(id)}`, { note }),
  async venueStoryMedia(id: string): Promise<{ url: string; mime: string }> {
    const response = await send('GET', `/admin/venue-stories/${encodeURIComponent(id)}/media`);
    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type };
  },
  resolvePostReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/posts/${encodeURIComponent(id)}/resolve`, { resolution, note }),
  userReports: (p: { resolved: boolean; offset: number }) => request<Page<UserReportRow>>('GET', `/admin/reports/users${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset, limit: getPageSize() })}`),
  resolveUserReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/users/${encodeURIComponent(id)}/resolve`, { resolution, note }),
  resolveConversationReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/conversations/${encodeURIComponent(id)}/resolve`, { resolution, note }),

  feedPosts: (p: { q: string; status?: 'pending' | 'published'; offset: number }) => request<Page<FeedPostRow>>('GET', `/admin/feed/posts${query({ ...p, limit: getPageSize() })}`),
  feedComments: (postId: string) => request<{ items: FeedCommentRow[] }>('GET', `/admin/feed/posts/${encodeURIComponent(postId)}/comments`),
  deleteFeedPost: (id: string, note: string) => request<unknown>('DELETE', `/admin/feed/posts/${encodeURIComponent(id)}`, { note }),
  deleteFeedComment: (id: string, note: string) => request<unknown>('DELETE', `/admin/feed/comments/${encodeURIComponent(id)}`, { note }),
  feedReports: (p: { resolved: boolean; offset: number }) => request<Page<FeedReportRow>>('GET', `/admin/reports/feed${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset, limit: getPageSize() })}`),
  resolveFeedReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/feed/${encodeURIComponent(id)}/resolve`, { resolution, note }),

  deleteComment: (id: string, note: string) => request<unknown>('DELETE', `/admin/comments/${encodeURIComponent(id)}`, { note }),

  eventExtras: () => request<{ items: EventExtra[]; icons: string[] }>('GET', '/admin/event-extras'),
  createEventExtra: (input: EventExtraInput) => request<{ items: EventExtra[] }>('POST', '/admin/event-extras', input),
  updateEventExtra: (id: string, input: EventExtraInput) => request<{ items: EventExtra[] }>('PUT', `/admin/event-extras/${encodeURIComponent(id)}`, input),
  moveEventExtra: (id: string, direction: 'up' | 'down') => request<{ items: EventExtra[] }>('POST', `/admin/event-extras/${encodeURIComponent(id)}/move`, { direction }),
  tastes: () => request<{ items: Taste[] }>('GET', '/admin/tastes'),
  createTaste: (input: TasteInput) => request<{ items: Taste[] }>('POST', '/admin/tastes', input),
  updateTaste: (id: string, input: TasteInput) => request<{ items: Taste[] }>('PUT', `/admin/tastes/${encodeURIComponent(id)}`, input),
  moveTaste: (id: string, direction: 'up' | 'down') => request<{ items: Taste[] }>('POST', `/admin/tastes/${encodeURIComponent(id)}/move`, { direction }),
  deleteTaste: (id: string) => request<{ items: Taste[] }>('DELETE', `/admin/tastes/${encodeURIComponent(id)}`),
  deleteEventExtra: (id: string) => request<{ items: EventExtra[] }>('DELETE', `/admin/event-extras/${encodeURIComponent(id)}`),

  audit: (offset: number) => request<Page<AuditRow>>('GET', `/admin/audit${query({ offset, limit: getPageSize() })}`),
};

/** Foto de uma publicação do feed (endereço público, como no app). */
export const feedImageUrl = (imageId: string) => `${API_BASE}/feed/images/${encodeURIComponent(imageId)}`;

/** Endereço do app para abrir a página de um evento ou rolê. */
const APP_SITE = ((import.meta.env.VITE_APP_URL as string | undefined) ?? 'https://askout.com.br').replace(/\/+$/, '');
export const appUrl = (path: string) => `${APP_SITE}${path}`;

/** Endereço público da foto de um post (o id é aleatório, como no app). */
export const postImageUrl = (imageId: string) => `${API_BASE}/posts/images/${encodeURIComponent(imageId)}`;
