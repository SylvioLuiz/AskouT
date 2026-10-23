import { validationError } from './errors.ts';
import type { PostReportReason } from './types.ts';
import { POST_REPORT_REASONS } from './types.ts';

export const USER_REPORT_DETAILS_MAX = 300;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Motivo (da lista) e detalhes opcionais de uma denúncia de perfil ou comentário. */
export function parseReportInput(reason: unknown, details: unknown): { reason: PostReportReason; details: string | null } {
  if (typeof reason !== 'string' || !(POST_REPORT_REASONS as readonly string[]).includes(reason)) throw validationError('Motivo inválido', { reason: 'Escolha um motivo da lista' });
  if (details === undefined || details === null || details === '') return { reason: reason as PostReportReason, details: null };
  if (typeof details !== 'string') throw validationError('Detalhes inválidos', { details: 'Detalhes inválidos' });
  const text = details.trim();
  if (text.length > USER_REPORT_DETAILS_MAX || CONTROL_RE.test(text)) throw validationError('Detalhes inválidos', { details: `Use no máximo ${USER_REPORT_DETAILS_MAX} caracteres` });
  return { reason: reason as PostReportReason, details: text === '' ? null : text };
}
