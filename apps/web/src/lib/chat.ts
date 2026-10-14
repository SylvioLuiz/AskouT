// Contas das conversas que não dependem de tela: horários, rótulos e junção de mensagens.
import { formatDistance } from './flash.ts';
import { formatVoiceTime } from './voice.ts';
import type { ChatMessage, SuggestionCard, SuggestionItem } from './types.ts';

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayMonth = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86_400_000;
/** Dias de calendário entre `date` e `now` (positivo = no passado), no fuso do aparelho. */
const dayDiff = (date: Date, now: Date) => Math.round((startOfDay(now) - startOfDay(date)) / DAY);

export function formatClock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : clock.format(d);
}

/** "Hoje", "Ontem", "segunda-feira" (últimos dias) ou "13 de out.". */
export function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = dayDiff(d, now);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff > 1 && diff < 7) return weekday.format(d);
  return dayMonth.format(d);
}

/** Para a lista de conversas: hora se foi hoje, senão o dia. */
export function listTimeLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return dayDiff(d, now) === 0 ? clock.format(d) : dayLabel(iso, now);
}

/** Quando o evento acontece, em palavras, sem fingir horário que não existe. */
export function formatWhen(startsAt: string | null, endsAt: string | null, now: Date): string {
  if (startsAt === null) return 'Horário não informado';
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return 'Horário não informado';
  const end = endsAt === null ? undefined : new Date(endsAt);
  const until = end && !Number.isNaN(end.getTime()) ? ` até ${clock.format(end)}` : '';
  if (start.getTime() <= now.getTime()) return `Acontecendo agora${until}`;
  const diff = -dayDiff(start, now);
  const day = diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : dayLabel(startsAt, now);
  return `${day} às ${clock.format(start)}${until}`;
}

/** "a 1,2 km de você · 800 m de Bia" */
export function formatDistances(item: Pick<SuggestionItem, 'distanceFromMeM' | 'distanceFromThemM'>, otherName: string): string {
  return `a ${formatDistance(item.distanceFromMeM)} de você · ${formatDistance(item.distanceFromThemM)} de ${otherName}`;
}

export function sourceLabel(source: SuggestionCard['source']): string {
  return source === 'EVENT' ? 'Evento no AskouT' : source === 'GOOGLE' ? 'Lugar do Google' : 'Lugar do OpenStreetMap';
}

/** 4.62 -> "4,6" */
export function formatRating(rating: number): string {
  return rating.toFixed(1).replace('.', ',');
}

/** "Nota 4,6 de 5, 321 avaliações no Google" */
export function ratingLabel(rating: number, count: number | null): string {
  const base = `Nota ${formatRating(rating)} de 5`;
  return count === null ? `${base} no Google` : `${base}, ${count} ${count === 1 ? 'avaliação' : 'avaliações'} no Google`;
}

/** Percentual de estrelas cheias (0–100), arredondado para meia estrela. */
export function starPercent(rating: number): number {
  const clamped = Math.min(5, Math.max(0, rating));
  return (Math.round(clamped * 2) / 10) * 100;
}

/** Rota a pé até o lugar, aberta no app de mapas a partir de onde a pessoa estiver. */
export function routeLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`;
}

/** O cartão que vai na mensagem: só os campos que o servidor aceita. */
export function toCard(item: SuggestionItem): SuggestionCard {
  return {
    source: item.source,
    title: item.title,
    venueName: item.venueName,
    lat: item.lat,
    lng: item.lng,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    sample: item.sample,
    externalId: item.key,
  };
}

/** Junta páginas de mensagens sem repetir, em ordem cronológica. */
export function mergeMessages(...lists: readonly (readonly ChatMessage[])[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const list of lists) for (const m of list) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
}

export function mapLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
}

/** Resumo para a lista de conversas. */
export function previewOf(m: ChatMessage | null): string {
  if (!m) return 'Nenhuma mensagem ainda';
  const prefix = m.mine ? 'Você: ' : '';
  if (m.kind === 'SUGGESTION' && m.suggestion) return `${prefix}Sugeriu ${m.suggestion.venueName}`;
  if (m.kind === 'AUDIO') return `${m.senderName && !m.mine ? `${m.senderName}: ` : prefix}Mensagem de voz${m.audio ? ` (${formatVoiceTime(m.audio.durationMs)})` : ''}`;
  if (m.kind === 'MEETUP') return `${prefix}${m.body}`;
  if (m.kind === 'EVENT') return `${m.senderName && !m.mine ? `${m.senderName}: ` : prefix}Compartilhou ${m.event?.title ?? 'um evento'}`;
  if (m.senderName && !m.mine) return `${m.senderName}: ${m.body.replace(/\s+/g, ' ')}`;
  return `${prefix}${m.body.replace(/\s+/g, ' ')}`;
}

/** Avisa o resto do app (a bolinha da aba Conversas) que as não lidas podem ter mudado. */
export const CHATS_CHANGED_EVENT = 'askout:chats-changed';
export function announceChatsChanged(): void {
  window.dispatchEvent(new Event(CHATS_CHANGED_EVENT));
}
