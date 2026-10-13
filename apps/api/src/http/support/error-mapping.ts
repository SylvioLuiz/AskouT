import { DomainError } from '../../core/errors.ts';
import type { ErrorCode } from '../../core/errors.ts';

export type HttpErrorCode = ErrorCode | 'INTERNAL';

export interface ErrorResponse {
  status: number;
  body: { error: { code: HttpErrorCode; message: string; details?: unknown } };
  headers: Record<string, string>;
}

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS[code];
}

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const e = error as { getStatus?: unknown; status?: unknown; statusCode?: unknown };
  const candidate = typeof e.getStatus === 'function' ? (e.getStatus as () => unknown)() : (e.status ?? e.statusCode);
  return typeof candidate === 'number' && candidate >= 400 && candidate <= 599 ? candidate : undefined;
}

/**
 * Converte qualquer erro na resposta HTTP. Regra de ouro: erro inesperado NUNCA vaza
 * mensagem, stack ou detalhes para o cliente (quem loga é o filtro).
 */
export function describeError(error: unknown): ErrorResponse {
  if (error instanceof DomainError) {
    const headers: Record<string, string> = {};
    // O núcleo entrega retryAfterSeconds como texto; aceitamos número também.
    const raw = (error.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    const retry = typeof raw === 'string' ? Number(raw) : raw;
    if (error.code === 'RATE_LIMITED' && typeof retry === 'number' && Number.isFinite(retry) && retry > 0) {
      headers['Retry-After'] = String(Math.ceil(retry));
    }
    return {
      status: statusForCode(error.code),
      body: { error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) } },
      headers,
    };
  }

  // Erros do framework/parser (JSON malformado, UUID inválido, rota inexistente, corpo grande demais).
  const status = httpStatusOf(error);
  if (status !== undefined && status < 500) {
    const code: HttpErrorCode =
      status === 400 ? 'VALIDATION' : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : 'VALIDATION';
    const message =
      status === 404 ? 'Recurso não encontrado' : status === 413 ? 'Requisição grande demais' : 'Requisição inválida';
    return { status, body: { error: { code, message } }, headers: {} };
  }

  return { status: 500, body: { error: { code: 'INTERNAL', message: 'Erro interno' } }, headers: {} };
}
