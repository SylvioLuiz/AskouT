import { query } from './labels.ts';
import type {
  AuditRow, AuthResult, Claim, ClaimStatus, ConversationReportRow, Page, PlaceEventRow, PostReportRow, PostRow, Resolution, StoryReportRow, SessionUser, Stats, UserRow, UserStatus, VenueRow,
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

const TOKEN_KEY = 'askout.admin.token';

/** O token fica só na sessão da aba (some ao fechar) e, se o navegador bloquear, na memória. */
let memoryToken: string | undefined;
export const session = {
  get(): string | undefined {
    try {
      return window.sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
    } catch {
      return memoryToken;
    }
  },
  set(token: string): void {
    memoryToken = token;
    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* só na memória */
    }
  },
  clear(): void {
    memoryToken = undefined;
    try {
      window.sessionStorage.removeItem(TOKEN_KEY);
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
    response = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
    if (response.status === 401 && token) onUnauthorized();
    throw new ApiError(response.status, code, message);
  }
  return response;
}

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const response = await send(method, path, body, auth);
  return (await response.json()) as T;
}

export const api = {
  login: (identifier: string, password: string) => request<AuthResult>('POST', '/admin/login', { identifier, password }, false),
  me: () => request<SessionUser>('GET', '/auth/me'),
  stats: () => request<Stats>('GET', '/admin/stats'),

  claims: (status: ClaimStatus) => request<Claim[]>('GET', `/admin/claims${query({ status })}`),
  /** Baixa o documento com o token e devolve um endereço temporário para exibir. */
  async claimDocument(id: string): Promise<{ url: string; mime: string }> {
    const response = await send('GET', `/admin/claims/${encodeURIComponent(id)}/document`);
    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type };
  },
  reviewClaim: (id: string, decision: 'APPROVED' | 'REJECTED', note: string) => request<unknown>('POST', `/admin/claims/${encodeURIComponent(id)}/review`, { decision, note }),

  users: (p: { q: string; status?: UserStatus; offset: number }) => request<Page<UserRow>>('GET', `/admin/users${query({ q: p.q, status: p.status, offset: p.offset })}`),
  setUserStatus: (id: string, status: 'ACTIVE' | 'SUSPENDED', note: string) => request<unknown>('PUT', `/admin/users/${encodeURIComponent(id)}/status`, { status, note }),

  venues: (p: { q: string; offset: number }) => request<Page<VenueRow>>('GET', `/admin/venues${query(p)}`),
  removeOwner: (venueId: string, note: string) => request<unknown>('DELETE', `/admin/venues/${encodeURIComponent(venueId)}/owner`, { note }),

  placeEvents: (p: { q: string; offset: number }) => request<Page<PlaceEventRow>>('GET', `/admin/place-events${query(p)}`),
  deletePlaceEvent: (id: string, note: string) => request<unknown>('DELETE', `/admin/place-events/${encodeURIComponent(id)}`, { note }),

  posts: (p: { q: string; events: boolean; offset: number }) => request<Page<PostRow>>('GET', `/admin/posts${query(p)}`),
  deletePost: (id: string, note: string) => request<unknown>('DELETE', `/admin/posts/${encodeURIComponent(id)}`, { note }),

  postReports: (p: { resolved: boolean; offset: number }) => request<Page<PostReportRow>>('GET', `/admin/reports/posts${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset })}`),
  conversationReports: (p: { resolved: boolean; offset: number }) => request<Page<ConversationReportRow>>('GET', `/admin/reports/conversations${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset })}`),
  storyReports: (p: { resolved: boolean; offset: number }) => request<Page<StoryReportRow>>('GET', `/admin/reports/stories${query({ status: p.resolved ? 'resolved' : undefined, offset: p.offset })}`),
  resolveStoryReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/stories/${encodeURIComponent(id)}/resolve`, { resolution, note }),
  deleteStory: (id: string, note: string) => request<unknown>('DELETE', `/admin/stories/${encodeURIComponent(id)}`, { note }),
  /** Baixa a mídia do story com o token e devolve um endereço temporário para exibir. */
  async storyMedia(id: string): Promise<{ url: string; mime: string }> {
    const response = await send('GET', `/admin/stories/${encodeURIComponent(id)}/media`);
    const blob = await response.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type };
  },
  resolvePostReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/posts/${encodeURIComponent(id)}/resolve`, { resolution, note }),
  resolveConversationReport: (id: string, resolution: Resolution, note: string) => request<unknown>('POST', `/admin/reports/conversations/${encodeURIComponent(id)}/resolve`, { resolution, note }),

  audit: (offset: number) => request<Page<AuditRow>>('GET', `/admin/audit${query({ offset })}`),
};

/** Endereço público da foto de um post (o id é aleatório, como no app). */
export const postImageUrl = (imageId: string) => `/api/posts/images/${encodeURIComponent(imageId)}`;
