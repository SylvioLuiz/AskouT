import { localToIso } from './post-draft.ts';
import type { ClaimState, ClaimStatus, EventKind, VenueEvent, VenueEventBody } from './types.ts';

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
  if (!(CLAIM_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return 'Envie um PDF ou uma imagem (JPEG, PNG ou WebP).';
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > CLAIM_DOCUMENT_MAX_BYTES) return 'O arquivo passa de 2 MB. Envie um menor.';
  return null;
}

export function claimStateLabel(state: ClaimState): string {
  switch (state) {
    case 'MINE':
      return 'Você administra';
    case 'TAKEN':
      return 'Já tem responsável';
    case 'PENDING':
      return 'Pedido em análise';
    default:
      return '';
  }
}

export function claimStatusLabel(status: ClaimStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Avaliação em andamento';
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
}

/** Capa enviada antes, servida pela própria API. */
export const isOwnCoverPath = (v: string): boolean => /^\/(place-events|venues)\/[\w-]+\/cover(\?v=\d+)?$/.test(v);

export const EMPTY_VENUE_EVENT: VenueEventDraft = { title: '', description: '', kind: 'OTHER', starts: '', ends: '', isFree: false, imageUrl: '', imageData: '', tags: '' };

/** Texto do primeiro problema do rascunho, ou null. `editing`: o início de um evento já existente pode estar no passado. */
export function venueEventProblem(d: VenueEventDraft, now: Date, editing: boolean): string | null {
  if (d.title.trim() === '') return 'Dê um nome ao evento.';
  if (Array.from(d.title.trim()).length > VENUE_EVENT_TITLE_MAX) return `O nome pode ter até ${VENUE_EVENT_TITLE_MAX} caracteres.`;
  if (Array.from(d.description).length > VENUE_EVENT_DESCRIPTION_MAX) return `A descrição pode ter até ${VENUE_EVENT_DESCRIPTION_MAX} caracteres.`;
  const start = localToIso(d.starts);
  if (!start) return 'Escolha quando o evento começa.';
  if (!editing && new Date(start).getTime() < now.getTime() - 5 * 60_000) return 'O início precisa ser no futuro.';
  if (d.ends !== '') {
    const end = localToIso(d.ends);
    if (!end) return 'A data de fim é inválida.';
    if (new Date(end).getTime() <= new Date(start).getTime()) return 'O fim precisa ser depois do início.';
    if (new Date(end).getTime() - new Date(start).getTime() > VENUE_EVENT_MAX_DAYS * 24 * 3_600_000) return `O evento pode durar até ${VENUE_EVENT_MAX_DAYS} dias.`;
  }
  if (d.imageData === '' && d.imageUrl.trim() !== '' && !isOwnCoverPath(d.imageUrl.trim()) && !/^https:\/\/\S+$/.test(d.imageUrl.trim())) return 'O endereço da imagem precisa começar com https://';
  if (parseTags(d.tags).length > VENUE_EVENT_TAGS_MAX) return `Use até ${VENUE_EVENT_TAGS_MAX} hashtags.`;
  return null;
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
  };
}

export function draftFromEvent(e: VenueEvent, isoToLocalInput: (iso: string) => string): VenueEventDraft {
  return { title: e.title, description: e.description ?? '', kind: e.kind, starts: isoToLocalInput(e.startsAt), ends: isoToLocalInput(e.endsAt), isFree: e.isFree, imageUrl: e.imageUrl ?? '', imageData: '', tags: e.tags.map((t) => `#${t}`).join(' ') };
}

export function phaseLabel(phase: VenueEvent['phase']): string {
  return phase === 'LIVE' ? 'Acontecendo agora' : phase === 'PAST' ? 'Já passou' : 'Vai acontecer';
}
