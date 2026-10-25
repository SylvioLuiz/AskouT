import { localToIso } from './post-draft.ts';
import type { ClaimState, ClaimStatus, EventKind, VenueEvent, VenueEventBody } from './types.ts';
import { t } from '../lib/i18n/index.ts';

/** Iguais aos limites da API. */
export const CLAIM_DOCUMENT_MAX_BYTES = 2 * 1024 * 1024;
export const CLAIM_NOTE_MAX = 300;
export const VENUE_EVENT_TITLE_MAX = 80;
export const VENUE_EVENT_DESCRIPTION_MAX = 1000;
export const VENUE_EVENT_TAGS_MAX = 5;
export const VENUE_EVENT_MAX_DAYS = 30;

export const CLAIM_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

/** Problema com o arquivo do documento, ou null se pode enviar. */
export function documentProblem(file: { type: string; size: number }): string | null {
  if (!(CLAIM_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return t('Envie um PDF ou uma imagem (JPEG, PNG ou WebP).');
  if (file.size === 0) return t('O arquivo está vazio.');
  if (file.size > CLAIM_DOCUMENT_MAX_BYTES) return t('O arquivo passa de 2 MB. Envie um menor.');
  return null;
}

export function claimStateLabel(state: ClaimState): string {
  switch (state) {
    case 'MINE':
      return t('Você administra');
    case 'TAKEN':
      return t('Já tem responsável');
    case 'PENDING':
      return t('Pedido em análise');
    default:
      return '';
  }
}

export function claimStatusLabel(status: ClaimStatus): string {
  switch (status) {
    case 'PENDING':
      return t('Avaliação em andamento');
    case 'APPROVED':
      return 'Aprovado';
    default:
      return 'Recusado';
  }
}

/** "#samba, música" vira ['samba', 'música']: sem #, sem repetidos, sem vazios. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const tag = part.replace(/^#+/, '').trim().toLowerCase();
    if (tag !== '') seen.add(tag);
  }
  return [...seen];
}

export interface VenueEventDraft {
  title: string;
  description: string;
  kind: EventKind;
  starts: string;
  ends: string;
  isFree: boolean;
  /** Endereço https (link da web) ou o caminho da capa já enviada. */
  imageUrl: string;
  /** Foto nova escolhida no aparelho (data URL já reduzida). */
  imageData: string;
  tags: string;
  /** Link para comprar ingresso (opcional). */
  ticketUrl: string;
}

/** Capa enviada antes, servida pela própria API. */
export const isOwnCoverPath = (v: string): boolean => /^\/(place-events|venues)\/[\w-]+\/(cover|logo)(\?v=\d+)?$/.test(v);

export const EMPTY_VENUE_EVENT: VenueEventDraft = { title: '', description: '', kind: 'OTHER', starts: '', ends: '', isFree: false, imageUrl: '', imageData: '', tags: '', ticketUrl: '' };

export const TICKET_URL_MAX = 500;

/** Problema do link de ingresso (ou null). Vazio é válido: o evento fica sem link. Espelha a regra da API. */
export function ticketUrlProblem(value: string): string | null {
  const raw = value.trim();
  if (raw === '') return null;
  const message = t('Use o endereço completo do ingresso, começando com https://');
  if (raw.length > TICKET_URL_MAX || !/^https:\/\/\S+$/.test(raw)) return message;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    if (url.username !== '' || url.password !== '' || !host.includes('.') || /^[\d.]+$/.test(host) || host.startsWith('[') || host.endsWith('.local') || host.endsWith('.internal')) return message;
  } catch {
    return message;
  }
  return null;
}

/** Só o site do link, para o botão dizer para onde vai: "https://www.sympla.com.br/x" -> "sympla.com.br". */
export function ticketHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Texto do primeiro problema do rascunho, ou null. `editing`: o início de um evento já existente pode estar no passado. */
export function venueEventProblem(d: VenueEventDraft, now: Date, editing: boolean): string | null {
  if (d.title.trim() === '') return 'Dê um nome ao evento.';
  if (Array.from(d.title.trim()).length > VENUE_EVENT_TITLE_MAX) return t('O nome pode ter até {VENUE_EVENT_TITLE_MAX} caracteres.', { VENUE_EVENT_TITLE_MAX });
  if (Array.from(d.description).length > VENUE_EVENT_DESCRIPTION_MAX) return t('A descrição pode ter até {VENUE_EVENT_DESCRIPTION_} caracteres.', { VENUE_EVENT_DESCRIPTION_: VENUE_EVENT_DESCRIPTION_MAX });
  const start = localToIso(d.starts);
  if (!start) return t('Escolha quando o evento começa.');
  if (!editing && new Date(start).getTime() < now.getTime() - 5 * 60_000) return t('O início precisa ser no futuro.');
  if (d.ends !== '') {
    const end = localToIso(d.ends);
    if (!end) return t('A data de fim é inválida.');
    if (new Date(end).getTime() <= new Date(start).getTime()) return t('O fim precisa ser depois do início.');
    if (new Date(end).getTime() - new Date(start).getTime() > VENUE_EVENT_MAX_DAYS * 24 * 3_600_000) return t('O evento pode durar até {VENUE_EVENT_MAX_DAYS} dias.', { VENUE_EVENT_MAX_DAYS });
  }
  if (d.imageData === '' && d.imageUrl.trim() !== '' && !isOwnCoverPath(d.imageUrl.trim()) && !/^https:\/\/\S+$/.test(d.imageUrl.trim())) return 'O endereço da imagem precisa começar com https://';
  if (parseTags(d.tags).length > VENUE_EVENT_TAGS_MAX) return t('Use até {VENUE_EVENT_TAGS_MAX} hashtags.', { VENUE_EVENT_TAGS_MAX });
  return ticketUrlProblem(d.ticketUrl);
}

export function venueEventBody(d: VenueEventDraft): VenueEventBody {
  return {
    title: d.title.trim(),
    description: d.description.trim() === '' ? null : d.description.trim(),
    kind: d.kind,
    startsAt: localToIso(d.starts) as string,
    endsAt: d.ends === '' ? null : localToIso(d.ends),
    isFree: d.isFree,
    ...(d.imageData !== '' ? { imageData: d.imageData } : { imageUrl: d.imageUrl.trim() === '' ? null : d.imageUrl.trim() }),
    tags: parseTags(d.tags),
    ticketUrl: d.ticketUrl.trim() === '' ? null : d.ticketUrl.trim(),
  };
}

export function draftFromEvent(e: VenueEvent, isoToLocalInput: (iso: string) => string): VenueEventDraft {
  return { title: e.title, description: e.description ?? '', kind: e.kind, starts: isoToLocalInput(e.startsAt), ends: isoToLocalInput(e.endsAt), isFree: e.isFree, imageUrl: e.imageUrl ?? '', imageData: '', tags: e.tags.map((t) => `#${t}`).join(' '), ticketUrl: e.ticketUrl ?? '' };
}

export function phaseLabel(phase: VenueEvent['phase']): string {
  return phase === 'LIVE' ? t('Acontecendo agora') : phase === 'PAST' ? t('Já passou') : t('Vai acontecer');
}
