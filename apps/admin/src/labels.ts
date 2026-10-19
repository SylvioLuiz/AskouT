import type { ClaimStatus, ReportReason, Resolution, UserStatus } from './types.ts';

export const REASON_LABEL: Record<ReportReason, string> = {
  SPAM: 'Spam',
  OFFENSIVE: 'Ofensivo',
  NUDITY: 'Nudez',
  VIOLENCE: 'Violência',
  FALSE_INFO: 'Informação falsa',
  OTHER: 'Outro motivo',
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Ativa',
  SUSPENDED: 'Suspensa',
  DELETION_REQUESTED: 'Exclusão pedida',
};

export const CLAIM_LABEL: Record<ClaimStatus, string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
};

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  DISMISSED: 'Sem problema',
  ACTIONED: 'Providência tomada',
};

export const ACTION_LABEL: Record<string, string> = {
  USER_SUSPENDED: 'Suspendeu a conta',
  USER_REACTIVATED: 'Reativou a conta',
  CLAIM_APPROVED: 'Aprovou pedido de dono',
  CLAIM_REJECTED: 'Recusou pedido de dono',
  VENUE_OWNER_REMOVED: 'Tirou o responsável do local',
  POST_REMOVED: 'Apagou um post',
  PLACE_EVENT_REMOVED: 'Apagou um evento do local',
  STORY_REMOVED: 'Apagou um story',
  REPORT_DISMISSED: 'Denúncia: sem problema',
  REPORT_ACTIONED: 'Denúncia: providência tomada',
};

export const TARGET_LABEL: Record<string, string> = {
  USER: 'Pessoa',
  CLAIM: 'Pedido',
  VENUE: 'Local',
  POST: 'Post',
  PLACE_EVENT: 'Evento do local',
  STORY: 'Story',
  STORY_REPORT: 'Denúncia de story',
  POST_REPORT: 'Denúncia de post',
  CONVERSATION_REPORT: 'Denúncia de conversa',
};

export const EVENT_KIND_LABEL: Record<string, string> = {
  SHOW: 'Show', NIGHT: 'Balada', GASTRONOMY: 'Gastronomia', CINEMA: 'Cinema', THEATER: 'Teatro', EXHIBITION: 'Exposição',
  OUTDOOR: 'Ar livre', SPORT: 'Esporte', OTHER: 'Outros',
};

const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTime.format(d).replace(/\./g, '');
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateOnly.format(d).replace(/\./g, '');
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Texto de busca → parâmetro de URL; vazio some. */
export function query(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '' || v === false) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Largura mínima para usar a gestão. */
export const MIN_DESKTOP_WIDTH = 1024;
