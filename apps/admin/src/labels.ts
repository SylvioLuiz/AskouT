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
  USER_BIRTHDATE_CHANGED: 'Corrigiu a data de nascimento',
  USER_PROFILE_EDITED: 'Editou o perfil',
  CLAIM_APPROVED: 'Aprovou pedido de dono',
  CLAIM_REJECTED: 'Recusou pedido de dono',
  VENUE_OWNER_REMOVED: 'Tirou o responsável do local',
  POST_REMOVED: 'Apagou um post',
  PLACE_EVENT_REMOVED: 'Apagou um evento do local',
  STORY_REMOVED: 'Apagou um story',
  FEED_POST_REMOVED: 'Apagou uma publicação do feed',
  FEED_COMMENT_REMOVED: 'Apagou um comentário do feed',
  COMMENT_REMOVED: 'Apagou um comentário de post',
  REPORT_DISMISSED: 'Denúncia: sem problema',
  REPORT_ACTIONED: 'Denúncia: providência tomada',
  HUNTER_ENABLED: 'Ligou o Hunter',
  HUNTER_DISABLED: 'Desligou o Hunter',
  HUNTER_EVENT_REMOVED: 'Removeu um evento do Hunter',
  HUNTER_EVENTS_REMOVED_ALL: 'Removeu todos os eventos do Hunter',
  PAYMENTS_ENABLED: 'Ligou o pagamento do impulsionamento',
  PAYMENTS_DISABLED: 'Desligou o pagamento do impulsionamento',
  BOOST_PACKAGES_UPDATED: 'Mudou os pacotes de impulsionamento à venda',
  EVENT_EXTRA_CREATED: 'Cadastrou configuração de evento',
  EVENT_EXTRA_UPDATED: 'Editou configuração de evento',
  EVENT_EXTRA_REMOVED: 'Apagou configuração de evento',
  TASTE_CREATED: 'Cadastrou gosto de rolê',
  TASTE_UPDATED: 'Editou gosto de rolê',
  TASTE_REMOVED: 'Apagou gosto de rolê',
  RECO_EXPERIMENT_ENABLED: 'Ligou o teste A/B do “Para você”',
  RECO_EXPERIMENT_CHANGED: 'Mudou o tamanho do controle do teste A/B',
  RECO_EXPERIMENT_DISABLED: 'Desligou o teste A/B do “Para você”',
};

export const TARGET_LABEL: Record<string, string> = {
  USER: 'Pessoa',
  SETTING: 'Configuração',
  CLAIM: 'Pedido',
  VENUE: 'Local',
  POST: 'Post',
  PLACE_EVENT: 'Evento do local',
  STORY: 'Story',
  STORY_REPORT: 'Denúncia de story',
  FEED_POST: 'Publicação do feed',
  FEED_COMMENT: 'Comentário do feed',
  COMMENT: 'Comentário de post',
  FEED_REPORT: 'Denúncia do feed',
  POST_REPORT: 'Denúncia de post',
  CONVERSATION_REPORT: 'Denúncia de conversa',
  USER_REPORT: 'Denúncia de perfil ou comentário',
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

const weekdayOnly = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
const hourMinute = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Quando um evento acontece, com o dia da semana: "ter, 12 de nov de 2026 · 21:00–03:00".
 * Se termina mais de um dia depois, mostra a data do fim também.
 */
export function formatEventWhen(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) return '—';
  const day = `${weekdayOnly.format(start)}, ${dateOnly.format(start)}`.replace(/\./g, '');
  if (Number.isNaN(end.getTime())) return `${day} · ${hourMinute.format(start)}`;
  const long = end.getTime() - start.getTime() > 24 * 3_600_000;
  return `${day} · ${hourMinute.format(start)}–${long ? `${dateOnly.format(end).replace(/\./g, '')}, ` : ''}${hourMinute.format(end)}`;
}

/** Duração em horas e minutos: "6h", "1h30", "45min". */
export function formatDuration(startsAt: string, endsAt: string): string {
  const minutes = Math.round((new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000);
  if (!Number.isFinite(minutes) || minutes <= 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}min` : m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/** Situação do evento agora: por vir, acontecendo ou já passou. */
export function eventStatus(startsAt: string, endsAt: string, now = Date.now()): 'UPCOMING' | 'LIVE' | 'PAST' {
  return new Date(endsAt).getTime() < now ? 'PAST' : new Date(startsAt).getTime() <= now ? 'LIVE' : 'UPCOMING';
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateOnly.format(d).replace(/\./g, '');
}

/** Data de nascimento AAAA-MM-DD como DD/MM/AAAA, sem passar por fuso (new Date mostraria o dia anterior em São Paulo). */
export function formatBirthDate(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
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

export const PAYMENT_PROVIDER_LABEL: Record<'sandbox' | 'stripe' | 'none', string> = {
  sandbox: 'Teste (não cobra de verdade)',
  stripe: 'Stripe (Pix e cartão)',
  none: 'Nenhum (a venda é só pelo app)',
};
