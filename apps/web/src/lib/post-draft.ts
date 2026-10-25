import type { CropRect } from './crop.ts';
import type { EventKind } from './types.ts';
import { t } from '../lib/i18n/index.ts';

export const POST_IMAGES_MAX = 5;
export const POST_CAPTION_MAX = 500;

export interface DraftUpload {
  key: string;
  kind: 'UPLOAD';
  preview: string;
  dataUrl: string;
  /** Cópia de trabalho (até 1600 px) para recortar de novo sem perder qualidade. */
  source?: string;
  crop?: CropRect;
  /** Item de vídeo: `preview`/`dataUrl` são a capa e o arquivo segue para a API depois que o post é criado. */
  video?: File;
}

export interface DraftPlacePhoto {
  key: string;
  kind: 'PLACE';
  preview: string;
  photoPath: string;
  author: string | null;
  placeName: string;
  placeAddress: string | null;
}

export type DraftImage = DraftUpload | DraftPlacePhoto;

export interface LinkedPlace {
  name: string;
  address: string | null;
}

/** Adiciona sem passar de 5 e sem repetir foto de lugar (a nova foto de lugar troca a anterior). */
export function addImages(current: readonly DraftImage[], added: readonly DraftImage[]): DraftImage[] {
  let next = [...current];
  for (const image of added) {
    if (image.kind === 'PLACE') next = next.filter((i) => i.kind !== 'PLACE');
    if (next.length >= POST_IMAGES_MAX) continue;
    next.push(image);
  }
  return next;
}

/** O vídeo do rascunho (no máximo um) e a posição dele entre os itens. */
export function videoOf(images: readonly DraftImage[]): { index: number; file: File } | undefined {
  const index = images.findIndex((i) => i.kind === 'UPLOAD' && i.video !== undefined);
  const item = images[index];
  return item && item.kind === 'UPLOAD' && item.video ? { index, file: item.video } : undefined;
}

/** O lugar do post: o da foto do lugar (fixo) ou o que a pessoa vinculou quando só tem fotos próprias. */
export function effectivePlace(images: readonly DraftImage[], linked: LinkedPlace | null): LinkedPlace | null {
  const fromPhoto = images.find((i): i is DraftPlacePhoto => i.kind === 'PLACE');
  if (fromPhoto) return { name: fromPhoto.placeName, address: fromPhoto.placeAddress };
  return linked;
}

export interface EventDraft {
  title: string;
  /** Tipo do evento (decide o ícone da página). Sem escolha, "Outros". */
  kind?: EventKind;
  /** Valor de <input type="datetime-local">, na hora do aparelho. */
  startsAt: string;
  endsAt: string;
  /** Evento privado: só vai para as conversas escolhidas e ninguém posta no perfil. */
  private?: boolean;
}

/** Converte o valor do campo de data/hora (hora local do aparelho) para ISO; vazio ou inválido vira null. */
export function localToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO para o valor de <input type="datetime-local"> (hora do aparelho). */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Duração máxima de um evento (igual à da API). */
export const POST_EVENT_MAX_DAYS = 30;

/** O que falta para publicar como evento (null = tudo certo). */
export function eventProblem(event: EventDraft, _place: LinkedPlace | null, now: Date): string | null {
  if (!event.title.trim()) return t('Dê um nome ao evento.');
  const start = localToIso(event.startsAt);
  if (!start) return t('Escolha o dia e a hora de início.');
  if (new Date(start).getTime() < now.getTime() - 5 * 60_000) return t('O início precisa ser no futuro.');
  if (event.endsAt) {
    const end = localToIso(event.endsAt);
    if (!end || new Date(end).getTime() <= new Date(start).getTime()) return t('O fim precisa ser depois do início.');
    if (new Date(end).getTime() - new Date(start).getTime() > POST_EVENT_MAX_DAYS * 24 * 3_600_000) return t('O evento pode durar até {POST_EVENT_MAX_DAYS} dias.', { POST_EVENT_MAX_DAYS });
  }
  return null;
}

/** Corpo do `POST /posts` a partir do rascunho. */
export function buildPostBody(images: readonly DraftImage[], caption: string, linked: LinkedPlace | null, tagUserIds: readonly string[], event: EventDraft | null = null, datePollId: string | null = null) {
  const place = effectivePlace(images, linked);
  return {
    images: images.map((i) => (i.kind === 'UPLOAD' ? i.dataUrl : { photoPath: i.photoPath, photoAuthor: i.author })),
    ...(caption.trim() ? { caption: caption.trim() } : {}),
    ...(place ? { placeName: place.name, ...(place.address ? { placeAddress: place.address } : {}) } : {}),
    ...(tagUserIds.length > 0 ? { tagUserIds: [...tagUserIds] } : {}),
    ...(event && datePollId ? { datePollId } : {}),
    ...(event ? { event: { title: event.title.trim(), kind: event.kind ?? 'OTHER', startsAt: localToIso(event.startsAt), ...(event.endsAt ? { endsAt: localToIso(event.endsAt) } : {}), ...(event.private ? { private: true } : {}) } } : {}),
  };
}
