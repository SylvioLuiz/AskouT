// Contas das conversas que não dependem de tela: horários, rótulos e junção de mensagens.
import { formatDistance } from './flash.ts';
import { formatVoiceTime } from './voice.ts';
import type { ChatMessage, ConversationItem, SuggestionCard, SuggestionItem } from './types.ts';
import { intlLocale, t } from '../lib/i18n/index.ts';

const clock = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });
const dayMonth = new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' });
const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long' });

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
  if (startsAt === null) return t('Horário não informado');
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return t('Horário não informado');
  const end = endsAt === null ? undefined : new Date(endsAt);
  const hasEnd = end !== undefined && !Number.isNaN(end.getTime());
  // O fim só leva a data quando cai em outro dia que o início (ou, em andamento, que hoje): eventos podem passar de 24 h.
  const sameDay = (a: Date, b: Date) => dayDiff(a, b) === 0;
  const endDay = (e: Date) => {
    const d = -dayDiff(e, now);
    return d === 0 ? t('hoje') : d === 1 ? t('amanhã') : dayMonth.format(e);
  };
  const reference = start.getTime() <= now.getTime() ? now : start;
  const until = hasEnd ? (sameDay(end, reference) ? t(' até {time}', { time: clock.format(end) }) : t(' até {day} às {time}', { day: endDay(end), time: clock.format(end) })) : '';
  if (start.getTime() <= now.getTime()) return t('Acontecendo agora{until}', { until });
  const diff = -dayDiff(start, now);
  const day = diff === 0 ? t('Hoje') : diff === 1 ? t('Amanhã') : dayLabel(startsAt, now);
  return t('{day} às {time}{until}', { day, time: clock.format(start), until });
}

/** "a 1,2 km de você · 800 m de Bia" */
export function formatDistances(item: Pick<SuggestionItem, 'distanceFromMeM' | 'distanceFromThemM'>, otherName: string): string {
  return t('a {me} de você · {them} de {otherName}', { me: formatDistance(item.distanceFromMeM), them: formatDistance(item.distanceFromThemM), otherName });
}

export function sourceLabel(source: SuggestionCard['source']): string {
  return source === 'EVENT' ? t('Evento no AskouT') : source === 'GOOGLE' ? t('Rolê do Google') : t('Rolê do OpenStreetMap');
}

/** 4.62 -> "4,6" */
export function formatRating(rating: number): string {
  return rating.toFixed(1).replace('.', ',');
}

/** "Nota 4,6 de 5, 321 avaliações no Google" */
export function ratingLabel(rating: number, count: number | null): string {
  const base = t('Nota {rating} de 5', { rating: formatRating(rating) });
  return count === null ? t('{base} no Google', { base }) : count === 1 ? t('{base}, 1 avaliação no Google', { base }) : t('{base}, {count} avaliações no Google', { base, count });
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
  if (!m) return t('Nenhuma mensagem ainda');
  const prefix = m.mine ? t('Você: ') : '';
  const who = m.senderName && !m.mine ? `${m.senderName}: ` : prefix;
  if (m.deleted) return `${who}${t('Mensagem apagada')}`;
  if (m.kind === 'IMAGE') return `${who}${t('Foto')}`;
  if (m.kind === 'VIDEO') return `${who}${t('Vídeo')}`;
  if (m.kind === 'SUGGESTION' && m.suggestion) return `${prefix}${t('Sugeriu {venueName}', { venueName: m.suggestion.venueName })}`;
  if (m.kind === 'AUDIO') return `${m.senderName && !m.mine ? `${m.senderName}: ` : prefix}${t('Mensagem de voz')}${m.audio ? ` (${formatVoiceTime(m.audio.durationMs)})` : ''}`;
  if (m.kind === 'MEETUP') return `${prefix}${m.body}`;
  if (m.kind === 'EVENT') return `${m.senderName && !m.mine ? `${m.senderName}: ` : prefix}${t('Compartilhou {title}', { title: m.event?.title ?? t('um evento') })}`;
  if (m.senderName && !m.mine) return `${m.senderName}: ${m.body.replace(/\s+/g, ' ')}`;
  return `${prefix}${m.body.replace(/\s+/g, ' ')}`;
}

/** Trecho da mensagem para a barra "Respondendo a…". */
export function replyPreview(m: ChatMessage): string {
  if (m.deleted) return t('Mensagem apagada');
  if (m.kind === 'AUDIO') return t('Mensagem de voz');
  if (m.kind === 'IMAGE') return t('Foto');
  if (m.kind === 'VIDEO') return t('Vídeo');
  if (m.kind === 'EVENT') return t('Evento: {title}', { title: m.event?.title ?? t('compartilhado') });
  if (m.kind === 'SUGGESTION' && m.suggestion) return t('Sugestão: {venueName}', { venueName: m.suggestion.venueName });
  return Array.from(m.body.replace(/\s+/g, ' ')).slice(0, 100).join('');
}

/** Sem acento e em minúsculas, para a busca não depender de como a pessoa digita. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Nome mostrado na lista: a pessoa (1 a 1) ou o nome do grupo. */
export function conversationTitle(c: Pick<ConversationItem, 'other' | 'name'>): string {
  return c.other ? c.other.displayName : (c.name ?? 'Grupo');
}

/** Busca na lista de conversas: nome, @usuário e a última mensagem. Sem texto, devolve tudo na mesma ordem. */
export function filterConversations(items: readonly ConversationItem[], query: string): ConversationItem[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];
  return items.filter((c) => {
    const haystack = fold(`${conversationTitle(c)} ${c.other?.username ?? ''} ${c.lastMessage && !c.lastMessage.deleted ? previewOf(c.lastMessage) : ''}`);
    return terms.every((t) => haystack.includes(t));
  });
}

/** Avisa o resto do app (a bolinha da aba Conversas) que as não lidas podem ter mudado. */
export const CHATS_CHANGED_EVENT = 'askout:chats-changed';
export function announceChatsChanged(): void {
  window.dispatchEvent(new Event(CHATS_CHANGED_EVENT));
}

/** Tipos que a pessoa pode apagar para todos (só as próprias mensagens). */
export const DELETABLE_KINDS: readonly ChatMessage['kind'][] = ['TEXT', 'AUDIO', 'IMAGE', 'VIDEO', 'EVENT'];

/** Mensagens sem opções: avisos do sistema e as já apagadas. */
export function selectable(m: ChatMessage): boolean {
  return m.kind !== 'SYSTEM' && !m.deleted;
}

/** Dá para apagar todas as escolhidas? Só se forem todas suas e de tipo apagável. */
export function allDeletable(messages: readonly ChatMessage[]): boolean {
  return messages.length > 0 && messages.every((m) => m.mine && !m.deleted && DELETABLE_KINDS.includes(m.kind));
}

/** Texto para copiar: uma mensagem sai pura; várias saem como "[hh:mm] Nome: texto", na ordem da conversa. Só texto entra. */
export function copyText(messages: readonly ChatMessage[]): string {
  const texts = messages.filter((m) => m.kind === 'TEXT' && !m.deleted && m.body.trim() !== '');
  if (texts.length === 0) return '';
  const first = texts[0];
  if (messages.length === 1 && first) return first.body;
  return texts.map((m) => `[${formatClock(m.createdAt)}] ${m.mine ? t('Você') : (m.senderName ?? t('Contato'))}: ${m.body}`).join('\n');
}
