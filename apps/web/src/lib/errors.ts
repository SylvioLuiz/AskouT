import { t } from '../lib/i18n/index.ts';
export type ApiErrorCode =
  | 'VALIDATION'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'NETWORK';

const KNOWN_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  'VALIDATION',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
]);

export interface ApiErrorOptions {
  status?: number;
  fields?: Record<string, string>;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Erros por campo de formulário (nome do campo -> mensagem), quando a API envia. */
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds: number | undefined;

  constructor(code: ApiErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? 0;
    this.fields = options.fields ?? {};
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Aproveita só os detalhes no formato { campo: "mensagem" }. */
export function fieldsFrom(details: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (typeof details !== 'object' || details === null || Array.isArray(details)) return result;
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string') result[key] = t(value);
  }
  return result;
}

const GENERIC = t('Algo deu errado. Tente de novo.');
const SERVER_DOWN = t('O AskouT está com problemas agora. Tente de novo em instantes.');

function codeForStatus(status: number): ApiErrorCode {
  if (status === 400) return 'VALIDATION';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'CONFLICT';
  if (status === 429) return 'RATE_LIMITED';
  return 'INTERNAL';
}

/** Monta o erro a partir do status HTTP, do corpo { error: { code, message, details } } e do Retry-After. */
export function errorFromResponse(status: number, payload: unknown, retryAfterHeader: string | null): ApiError {
  const raw =
    typeof payload === 'object' && payload !== null ? (payload as { error?: unknown }).error : undefined;
  const body = typeof raw === 'object' && raw !== null ? (raw as { code?: unknown; message?: unknown; details?: unknown }) : {};

  const code: ApiErrorCode =
    typeof body.code === 'string' && KNOWN_CODES.has(body.code) ? (body.code as ApiErrorCode) : codeForStatus(status);

  let message = typeof body.message === 'string' && body.message.trim() !== '' ? t(body.message) : GENERIC;
  if (status >= 500) message = SERVER_DOWN;

  const parsedRetry = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
  const retryAfterSeconds = Number.isFinite(parsedRetry) && parsedRetry > 0 ? Math.ceil(parsedRetry) : undefined;

  return new ApiError(code, message, { status, fields: fieldsFrom(body.details), retryAfterSeconds });
}

export function networkError(): ApiError {
  return new ApiError('NETWORK', t('Não foi possível conectar ao AskouT. Verifique sua internet e tente de novo.'));
}

/** Garante um ApiError para mostrar na tela, seja qual for o erro capturado. */
export function toApiError(value: unknown): ApiError {
  if (value instanceof ApiError) return value;
  return new ApiError('INTERNAL', GENERIC);
}
