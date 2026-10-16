import { buildEventCards } from './event-card.ts';
import type { EventCardView } from './event-card.ts';
import { decodeAudioDataUrl, parseAudioDuration } from './audio.ts';
import { decodeImageDataUrl } from './image.ts';
import { parseChatMedia } from './media.ts';
import type { ChatMedia } from './media.ts';
import { conflict, forbidden, notFound, rateLimited, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import { distanceMeters } from './geo.ts';
import { buildMeetupViews } from './meetup-view.ts';
import type { MeetupView } from './meetup-view.ts';
import type { ConversationRecord, MessageKind, MessageReactionRecord, MessageRecord, PostReportReason, PublicProfile, SuggestionCard } from './types.ts';
import { DELETED_BODY, POST_REPORT_REASONS, toPublicProfile } from './types.ts';

export const MESSAGE_MAX = 2000;
export const MESSAGES_PER_MINUTE = 30;
export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;
export const GROUP_NAME_MAX = 60;
export const GROUP_IMAGE_MAX_BYTES = 40 * 1024;
/** Reações disponíveis. Uma por pessoa e mensagem; tocar na mesma tira. */
export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
/** Conversas fixadas por pessoa. */
export const PINNED_MAX = 5;
/** "Digitando…" some sozinho depois disso sem novo sinal. */
export const TYPING_TTL_MS = 8_000;
const REPLY_PREVIEW_MAX = 100;

// Tudo menos tab, nova linha e retorno de carro.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface MessageView {
  id: string;
  senderId: string;
  mine: boolean;
  /** Nome de quem enviou; só nas conversas de grupo (na 1 a 1 já se sabe quem é). */
  senderName: string | null;
  kind: MessageKind;
  body: string;
  suggestion: SuggestionCard | null;
  /** Cartão do encontro (kind MEETUP), do seu ponto de vista. */
  meetup: MeetupView | null;
  /** Evento compartilhado (kind EVENT). */
  event: EventCardView | null;
  /** Mensagem de voz (kind AUDIO): só a duração; o áudio vem de `GET .../messages/:id/audio`. */
  audio: { durationMs: number } | null;
  /** Apagada por quem enviou: o conteúdo some para todos. */
  deleted: boolean;
  /** Mensagem a que esta responde. */
  replyTo: ReplyView | null;
  /** Reações agrupadas por emoji. */
  reactions: ReactionView[];
  /** Resposta de quem recebeu o cartão: aceitou ou recusou o lugar. */
  response: 'ACCEPTED' | 'DECLINED' | null;
  respondedAt: string | null;
  /**
   * Distância em linha reta do lugar até cada um, enquanto o encontro Flash está ativo e os dois compartilham
   * a localização. Calculada na hora e nunca guardada: quando o encontro acaba, some.
   */
  distances: { meM: number; themM: number } | null;
  createdAt: string;
}

export interface ReplyView {
  id: string;
  senderName: string;
  mine: boolean;
  kind: MessageKind;
  /** Trecho do texto (ou "Foto", "Vídeo", "Mensagem de voz"); vazio se a original foi apagada. */
  preview: string;
  deleted: boolean;
}

export interface ReactionView {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ConversationListItem {
  id: string;
  type: 'DIRECT' | 'GROUP';
  /** Na conversa 1 a 1, a outra pessoa; no grupo, nulo. */
  other: PublicProfile | null;
  /** Nome do grupo; nulo na conversa 1 a 1. */
  name: string | null;
  /** Foto do grupo (data URL); nula na 1 a 1 ou sem foto. */
  imageUrl: string | null;
  memberCount: number;
  lastMessage: MessageView | null;
  unread: number;
  /** Na 1 a 1, só amigos conversam: se deixaram de ser, o histórico continua legível, mas sem enviar. */
  canSend: boolean;
  /** Fixada no topo da lista (só para você). */
  pinned: boolean;
  /** Sem avisos de mensagem nova (só para você). */
  muted: boolean;
}

export interface ConversationView {
  id: string;
  type: 'DIRECT' | 'GROUP';
  other: PublicProfile | null;
  name: string | null;
  imageUrl: string | null;
  memberCount: number;
  canSend: boolean;
  /** Você é quem criou o grupo (pode renomear, trocar a foto e remover pessoas). */
  isOwner: boolean;
  pinned: boolean;
  muted: boolean;
  /** Nomes de quem está digitando agora. */
  typing: string[];
  /** Relógio do servidor. */
  now: string;
  /** Em ordem cronológica. */
  messages: MessageView[];
  hasMore: boolean;
}

export interface SharedLink {
  messageId: string;
  url: string;
  senderName: string;
  mine: boolean;
  createdAt: string;
}

export interface SharedMedia {
  messageId: string;
  kind: 'IMAGE' | 'VIDEO';
  senderName: string;
  mine: boolean;
  createdAt: string;
}

export interface SharedVoice {
  messageId: string;
  durationMs: number;
  senderName: string;
  mine: boolean;
  createdAt: string;
}

/** O que já foi trocado na conversa: encontros, links e mensagens de voz (tela de informações). */
export interface SharedView {
  type: 'DIRECT' | 'GROUP';
  /** Na conversa 1 a 1, a outra pessoa. */
  other: PublicProfile | null;
  name: string | null;
  imageUrl: string | null;
  meetups: MeetupView[];
  links: SharedLink[];
  voice: SharedVoice[];
  media: SharedMedia[];
}

export const CONVERSATION_REPORT_DETAILS_MAX = 300;
const SHARED_SCAN = 300;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;

/** Links de um texto, sem pontuação colada no fim, sem repetir. */
export function extractLinks(text: string): string[] {
  const found = (text.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?)\]]+$/, '')).filter((u) => u.length > 8);
  return [...new Set(found)];
}

export type GroupRoleView = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface GroupDetails {
  id: string;
  name: string;
  ownerId: string;
  /** Foto do grupo (data URL) ou nula. */
  imageUrl: string | null;
  members: { profile: PublicProfile; role: GroupRoleView; follow: 'NONE' | 'PENDING' | 'FOLLOWING' }[];
  /** Você é o dono ou administrador: pode editar nome e foto e remover membros. */
  canManage: boolean;
  meetups: MeetupView[];
  /** Fotos e vídeos da conversa ficam na aba Mídia (`GET .../shared`). */
  mediaAvailable: true;
}

export interface SendInput {
  body?: unknown;
  suggestion?: unknown;
  /** Compartilha um evento na conversa. */
  eventId?: unknown;
  /** Mensagem de voz: data URL do áudio gravado e `audioMs` (duração). */
  audio?: unknown;
  audioMs?: unknown;
  /** Foto ou vídeo já lido do corpo da requisição (bytes e tipo). */
  media?: { mime: unknown; data: unknown };
  /** Responde a esta mensagem (junto de qualquer conteúdo). */
  replyToId?: unknown;
}

interface ViewExtras {
  distances?: MessageView['distances'];
  senderName?: string | null;
  meetup?: MeetupView | null;
  event?: EventCardView | null;
  replyTo?: ReplyView | null;
  reactions?: ReactionView[];
}

function toMessageView(m: MessageRecord, actorId: string, extras: ViewExtras = {}): MessageView {
  const distances = extras.distances ?? null;
  const gone = m.deletedAt != null;
  return {
    id: m.id,
    senderId: m.senderId,
    mine: m.senderId === actorId,
    senderName: extras.senderName ?? null,
    kind: m.kind,
    body: gone ? '' : m.body,
    suggestion: gone ? null : m.suggestion,
    meetup: gone ? null : (extras.meetup ?? null),
    event: gone ? null : (extras.event ?? null),
    audio: !gone && m.kind === 'AUDIO' && m.audioMs ? { durationMs: m.audioMs } : null,
    deleted: gone,
    replyTo: gone ? null : (extras.replyTo ?? null),
    reactions: gone ? [] : (extras.reactions ?? []),
    response: m.response,
    respondedAt: m.respondedAt ? m.respondedAt.toISOString() : null,
    distances: m.suggestion && !gone ? distances : null,
    createdAt: m.createdAt.toISOString(),
  };
}

const PREVIEW_BY_KIND: Partial<Record<MessageKind, string>> = { AUDIO: 'Mensagem de voz', IMAGE: 'Foto', VIDEO: 'Vídeo' };

function previewOf(m: MessageRecord): string {
  if (m.deletedAt) return '';
  return PREVIEW_BY_KIND[m.kind] ?? Array.from(m.body.replace(/\s+/g, ' ')).slice(0, REPLY_PREVIEW_MAX).join('');
}

function groupReactions(rows: MessageReactionRecord[], actorId: string): Map<string, ReactionView[]> {
  const by = new Map<string, Map<string, ReactionView>>();
  for (const r of rows) {
    const perMessage = by.get(r.messageId) ?? new Map<string, ReactionView>();
    const cur = perMessage.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
    cur.count += 1;
    if (r.userId === actorId) cur.mine = true;
    perMessage.set(r.emoji, cur);
    by.set(r.messageId, perMessage);
  }
  const order = (e: string) => REACTIONS.indexOf(e as (typeof REACTIONS)[number]);
  return new Map([...by].map(([id, m]) => [id, [...m.values()].sort((a, b) => b.count - a.count || order(a.emoji) - order(b.emoji))] as const));
}

function parseText(value: unknown): string {
  if (typeof value !== 'string') throw validationError('Escreva uma mensagem', { body: 'Escreva uma mensagem' });
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text === '') throw validationError('Escreva uma mensagem', { body: 'Escreva uma mensagem' });
  if (Array.from(text).length > MESSAGE_MAX) {
    throw validationError(`Use no máximo ${MESSAGE_MAX} caracteres`, { body: `Use no máximo ${MESSAGE_MAX} caracteres` });
  }
  if (CONTROL_CHARS_RE.test(text)) throw validationError('A mensagem tem caracteres inválidos', { body: 'Caracteres inválidos' });
  return text;
}

function shortText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || Array.from(value.trim()).length > max || CONTROL_CHARS_RE.test(value)) {
    throw validationError('Sugestão inválida', { suggestion: `Campo ${field} inválido` });
  }
  return value.trim();
}

function isoOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw validationError('Sugestão inválida', { suggestion: `Campo ${field} inválido` });
  }
  return new Date(value).toISOString();
}

/** Reconstrói o cartão campo a campo: nada além dos campos conhecidos passa. */
export function parseSuggestion(value: unknown): SuggestionCard {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw validationError('Sugestão inválida', { suggestion: 'Sugestão inválida' });
  const v = value as Record<string, unknown>;
  if (v.source !== 'EVENT' && v.source !== 'OSM' && v.source !== 'GOOGLE') throw validationError('Sugestão inválida', { suggestion: 'Campo source inválido' });
  const lat = v.lat;
  const lng = v.lng;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 || typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw validationError('Sugestão inválida', { suggestion: 'Localização do lugar inválida' });
  }
  if (typeof v.sample !== 'boolean') throw validationError('Sugestão inválida', { suggestion: 'Campo sample inválido' });
  return {
    source: v.source,
    title: shortText(v.title, 'title', 120),
    venueName: shortText(v.venueName, 'venueName', 120),
    lat,
    lng,
    startsAt: isoOrNull(v.startsAt, 'startsAt'),
    endsAt: isoOrNull(v.endsAt, 'endsAt'),
    sample: v.sample,
    externalId: shortText(v.externalId, 'externalId', 80),
  };
}

/** Foto do grupo: até 40 KB. Devolve o próprio data URL (o grupo guarda assim). */
export function parseGroupImage(value: unknown): string {
  decodeImageDataUrl(value, GROUP_IMAGE_MAX_BYTES, '40 KB');
  return value as string;
}

const GROUP_MAX_MEMBERS = 15;

export class ConversationService {
  private readonly deps: CoreDeps;
  /** Quem está digitando: `conversa|pessoa` → instante em que o sinal expira. Fica só na memória (é efêmero). */
  private readonly typingUntil = new Map<string, number>();

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Abre (ou cria) a conversa com um amigo. */
  async open(actorId: string, otherId: unknown): Promise<{ id: string }> {
    const { conversations, follows, blocks, clock, ids } = this.deps;
    if (typeof otherId !== 'string' || otherId === '' || otherId.length > 64) throw validationError('Pessoa inválida', { userId: 'Pessoa inválida' });
    if (otherId === actorId) throw validationError('Você não pode conversar consigo mesmo');
    if (await blocks.existsEitherWay(actorId, otherId)) throw notFound('Pessoa não encontrada');
    const friends = await follows.listFriendIds(actorId);
    if (!friends.includes(otherId)) throw forbidden('Só amigos podem conversar');
    const conversation = await conversations.getOrCreateDirect(actorId, otherId, ids.next(), clock.now());
    return { id: conversation.id };
  }

  /** Cria um grupo com amigos (2 a 15 pessoas além de quem cria). Quem criou é o dono; as pessoas entram direto e recebem um aviso. */
  async createGroup(actorId: string, input: { name?: unknown; memberIds?: unknown }): Promise<{ id: string }> {
    const { conversations, follows, blocks, clock, ids } = this.deps;
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '' || CONTROL_CHARS_RE.test(name) || Array.from(name).length > GROUP_NAME_MAX) throw validationError('Nome inválido', { name: `Use de 1 a ${GROUP_NAME_MAX} caracteres` });
    if (!Array.isArray(input.memberIds)) throw validationError('Escolha as pessoas', { memberIds: 'Escolha ao menos duas pessoas' });
    const memberIds = [...new Set(input.memberIds)];
    for (const m of memberIds) {
      if (typeof m !== 'string' || m === '' || m.length > 64) throw validationError('Pessoa inválida', { memberIds: 'Pessoa inválida' });
      if (m === actorId) throw validationError('Você já está no grupo', { memberIds: 'Não escolha a si mesmo' });
    }
    if (memberIds.length < 2) throw validationError('Escolha ao menos duas pessoas', { memberIds: 'Para uma conversa só com uma pessoa, abra a conversa dela' });
    if (memberIds.length > GROUP_MAX_MEMBERS) throw validationError(`No máximo ${GROUP_MAX_MEMBERS} pessoas`, { memberIds: `No máximo ${GROUP_MAX_MEMBERS} pessoas` });
    const members = memberIds as string[];
    const [friends, related] = await Promise.all([follows.listFriendIds(actorId), blocks.listRelatedIds(actorId)]);
    for (const m of members) {
      if (related.includes(m)) throw notFound('Pessoa não encontrada');
      if (!friends.includes(m)) throw forbidden('Só amigos podem entrar no grupo');
    }
    const now = clock.now();
    const group = await conversations.createGroup({ id: ids.next(), name, ownerId: actorId, now });
    for (const m of members) await conversations.addParticipant(group.id, m, now);
    const creator = await this.nameOf(actorId);
    await this.postSystem(group.id, actorId, `${creator} criou o grupo`, now);
    await conversations.markRead(group.id, actorId, now);
    await this.notifyMembers(actorId, creator, group, members, 'adicionou você ao grupo');
    return { id: group.id };
  }

  /** Garante a conversa entre dois amigos (usado pelo Flash ao aceitar). Quem chama já checou amizade e bloqueio. */
  async ensureBetween(a: string, b: string): Promise<ConversationRecord> {
    return this.deps.conversations.getOrCreateDirect(a, b, this.deps.ids.next(), this.deps.clock.now());
  }

  async list(actorId: string): Promise<ConversationListItem[]> {
    const { conversations, follows, blocks, users } = this.deps;
    const blocked = await blocks.listRelatedIds(actorId);
    const [summaries, friends] = await Promise.all([conversations.listForUser(actorId, blocked), follows.listFriendIds(actorId)]);
    const hidden = new Set(blocked);
    const rows = summaries
      .map((s) => ({ s, otherId: s.conversation.type === 'DIRECT' ? (s.participantIds.find((id) => id !== actorId) ?? null) : null }))
      .filter(({ s, otherId }) => s.conversation.type === 'GROUP' || (otherId !== null && !hidden.has(otherId)));
    const profiles = new Map((await users.findProfilesByIds(rows.flatMap((v) => (v.otherId ? [v.otherId] : [])))).map((p) => [p.userId, p] as const));
    const items: ConversationListItem[] = [];
    const pins = new Map<string, number>();
    for (const { s, otherId } of rows) {
      const profile = otherId ? profiles.get(otherId) : undefined;
      if (s.conversation.type === 'DIRECT' && !profile) continue;
      items.push({
        id: s.conversation.id,
        type: s.conversation.type,
        other: profile ? toPublicProfile(profile) : null,
        name: s.conversation.name,
        imageUrl: s.conversation.imageUrl,
        memberCount: s.conversation.type === 'GROUP' ? s.participantIds.filter((id) => !hidden.has(id)).length : s.participantIds.length,
        lastMessage: s.lastMessage ? toMessageView(s.lastMessage, actorId) : null,
        unread: s.unread,
        canSend: s.conversation.type === 'GROUP' ? true : otherId !== null && friends.includes(otherId),
        pinned: s.pinnedAt != null,
        muted: s.muted === true,
      });
      if (s.pinnedAt) pins.set(s.conversation.id, s.pinnedAt.getTime());
    }
    // Fixadas primeiro (a fixada há menos tempo no topo); o resto segue a ordem do repositório (última mensagem).
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => Number(b.item.pinned) - Number(a.item.pinned) || (b.item.pinned ? (pins.get(b.item.id) ?? 0) - (pins.get(a.item.id) ?? 0) : 0) || a.index - b.index)
      .map(({ item }) => item);
  }

  /** Mensagens da conversa. A primeira página (sem `before`) também marca a conversa como lida. */
  async messages(actorId: string, conversationId: string, query: { limit?: unknown; before?: unknown } = {}): Promise<ConversationView> {
    const { conversations, clock } = this.deps;
    const { conversation, memberIds, otherId, other } = await this.access(actorId, conversationId);
    const limit = this.parseLimit(query.limit);
    let before: Date | undefined;
    if (query.before !== undefined && query.before !== null && query.before !== '') {
      const parsed = typeof query.before === 'string' ? Date.parse(query.before) : Number.NaN;
      if (Number.isNaN(parsed)) throw validationError('Data inválida', { before: 'Data inválida' });
      before = new Date(parsed);
    }
    const now = clock.now();
    // Em grupo, quem tem bloqueio com você (nos dois sentidos) some do chat, como na conversa 1 a 1.
    const hiddenIds = conversation.type === 'GROUP' ? await this.deps.blocks.listRelatedIds(actorId) : [];
    const clearedAt = (await conversations.getCleared(conversationId, actorId)) ?? undefined;
    const page = await conversations.listMessages(conversationId, limit + 1, before, hiddenIds, clearedAt);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(page.length - limit) : page;
    if (before === undefined) await conversations.markRead(conversationId, actorId, now);
    const isGroup = conversation.type === 'GROUP';
    const friends = isGroup ? [] : await this.deps.follows.listFriendIds(actorId);
    const positions = otherId && items.some((m) => m.suggestion) ? await this.livePositions(actorId, otherId, now) : null;

    const meetupIds = [...new Set(items.flatMap((m) => (m.meetupId ? [m.meetupId] : [])))];
    const records = (await Promise.all(meetupIds.map((id) => this.deps.meetups.find(id)))).filter((m) => m !== undefined);
    const meetupViews = new Map((await buildMeetupViews(this.deps, actorId, records)).map((v) => [v.id, v] as const));
    const eventCards = await buildEventCards(this.deps, items.flatMap((m) => (m.eventId ? [m.eventId] : m.postEventId ? [m.postEventId] : [])));
    const names = isGroup ? new Map((await this.deps.users.findProfilesByIds([...new Set(items.map((m) => m.senderId))])).map((p) => [p.userId, p.displayName] as const)) : null;
    const decor = await this.decorate(actorId, items);
    const prefs = await conversations.getPrefs(conversationId, actorId);

    return {
      id: conversationId,
      type: conversation.type,
      other: other ? toPublicProfile(other) : null,
      name: conversation.name,
      imageUrl: conversation.imageUrl,
      memberCount: memberIds.filter((id) => !hiddenIds.includes(id)).length,
      isOwner: conversation.ownerId === actorId,
      pinned: prefs.pinnedAt !== null,
      muted: prefs.muted,
      typing: await this.typingNames(actorId, conversationId, memberIds, hiddenIds, now),
      canSend: isGroup ? true : otherId !== null && friends.includes(otherId),
      now: now.toISOString(),
      messages: items.map((m) =>
        toMessageView(m, actorId, {
          distances: m.suggestion && otherId ? this.distancesOf(m.suggestion, positions) : null,
          senderName: names ? (names.get(m.senderId) ?? null) : null,
          meetup: m.meetupId ? (meetupViews.get(m.meetupId) ?? null) : null,
          event: m.eventId || m.postEventId ? (eventCards.get((m.eventId ?? m.postEventId) as string) ?? null) : null,
          replyTo: decor.replies.get(m.id) ?? null,
          reactions: decor.reactions.get(m.id) ?? [],
        }),
      ),
      hasMore,
    };
  }

  async send(actorId: string, conversationId: string, input: SendInput): Promise<MessageView> {
    const { conversations, follows, clock, ids } = this.deps;
    const { conversation, otherId, memberIds } = await this.access(actorId, conversationId);
    const hasText = input.body !== undefined && input.body !== null;
    const hasSuggestion = input.suggestion !== undefined && input.suggestion !== null;
    const hasEvent = input.eventId !== undefined && input.eventId !== null;
    const hasAudio = input.audio !== undefined && input.audio !== null;
    const hasMedia = input.media !== undefined && input.media !== null;
    if ([hasText, hasSuggestion, hasEvent, hasAudio, hasMedia].filter(Boolean).length !== 1) throw validationError('Envie um texto, uma sugestão, um evento, um áudio, uma foto ou um vídeo', { body: 'Envie um texto, uma sugestão, um evento, um áudio, uma foto ou um vídeo' });
    if (hasSuggestion && conversation.type === 'GROUP') throw validationError('Sugestões de lugar só em conversas 1 a 1', { suggestion: 'Sugestões de lugar só em conversas 1 a 1' });

    let kind: MessageKind = 'TEXT';
    let body = '';
    let suggestion: SuggestionCard | null = null;
    let eventId: string | null = null;
    let postEventId: string | null = null;
    let eventCard: EventCardView | null = null;
    let audio: { mime: string; data: Uint8Array } | undefined;
    let media: ChatMedia | undefined;
    let audioMs: number | null = null;
    if (hasMedia) {
      media = parseChatMedia((input.media as { mime: unknown }).mime, (input.media as { data: unknown }).data);
      kind = media.kind;
      body = media.kind === 'IMAGE' ? 'Foto' : 'Vídeo';
    } else if (hasAudio) {
      const decoded = decodeAudioDataUrl(input.audio);
      audioMs = parseAudioDuration(input.audioMs);
      audio = { mime: decoded.mime, data: new Uint8Array(decoded.bytes) };
      kind = 'AUDIO';
      body = 'Mensagem de voz';
    } else if (hasEvent) {
      if (typeof input.eventId !== 'string' || input.eventId === '' || input.eventId.length > 64) throw notFound('Evento não encontrado');
      eventCard = (await buildEventCards(this.deps, [input.eventId])).get(input.eventId) ?? null;
      if (!eventCard) throw notFound('Evento não encontrado');
      if (eventCard.userEvent) {
        // Evento de pessoa: o dono envia; outros só reencaminham o que receberam, e nunca um evento privado.
        if (eventCard.ownerId !== actorId) {
          if (eventCard.private) throw forbidden('Este evento é privado: só quem criou pode enviar');
          if (!(await conversations.hasPostEventAccess(actorId, eventCard.id)) && !(await follows.get(actorId, eventCard.ownerId ?? ''))) throw notFound('Evento não encontrado');
        }
        postEventId = eventCard.id;
      } else {
        eventId = eventCard.id;
      }
      kind = 'EVENT';
      body = `Evento: ${eventCard.title}`;
    } else if (hasSuggestion) {
      suggestion = parseSuggestion(input.suggestion);
      kind = 'SUGGESTION';
      body = `${suggestion.title} — ${suggestion.venueName}`;
    } else {
      body = parseText(input.body);
    }

    if (otherId) {
      const friends = await follows.listFriendIds(actorId);
      if (!friends.includes(otherId)) throw forbidden('Vocês não são mais amigos. Não dá para enviar mensagens.');
    }

    const now = clock.now();
    const recent = await conversations.countSentSince(actorId, new Date(now.getTime() - 60_000));
    if (recent >= MESSAGES_PER_MINUTE) throw rateLimited('Você está enviando mensagens rápido demais. Espere um instante.', 30);

    const replyToId = await this.parseReply(conversationId, input.replyToId);
    const message: MessageRecord = { id: ids.next(), conversationId, senderId: actorId, kind, body, suggestion, response: null, respondedAt: null, meetupId: null, eventId, postEventId, audioMs, replyToId, createdAt: now };
    await conversations.addMessage(message, audio ?? (media ? { mime: media.mime, data: media.data } : undefined));
    this.typingUntil.delete(`${conversationId}|${actorId}`);
    await conversations.markRead(conversationId, actorId, now);
    const positions = suggestion && otherId ? await this.livePositions(actorId, otherId, now) : null;
    const actorProfile = (await this.deps.users.findProfilesByIds([actorId]))[0];
    const actorName = actorProfile?.username ?? 'Alguém';
    // Dentro da conversa aparece o nome real; o aviso (sino/push) usa só o usuário.
    const senderName = conversation.type === 'GROUP' ? (actorProfile?.displayName ?? actorName) : null;
    await this.notifyMembers(actorId, actorName, conversation, memberIds, audio ? 'enviou um áudio' : media ? (media.kind === 'IMAGE' ? 'enviou uma foto' : 'enviou um vídeo') : eventCard ? 'compartilhou um evento' : suggestion ? 'sugeriu um lugar' : 'enviou uma mensagem');
    const decor = await this.decorate(actorId, [message]);
    return toMessageView(message, actorId, { distances: suggestion ? this.distancesOf(suggestion, positions) : null, senderName, event: eventCard, replyTo: decor.replies.get(message.id) ?? null });
  }

  /** Bytes de uma foto ou vídeo, só para quem está na conversa. */
  async media(actorId: string, conversationId: string, messageId: string): Promise<{ mime: string; data: Uint8Array }> {
    await this.access(actorId, conversationId);
    const message = typeof messageId === 'string' && messageId.length <= 64 ? await this.deps.conversations.findMessage(messageId) : undefined;
    if (!message || message.conversationId !== conversationId || (message.kind !== 'IMAGE' && message.kind !== 'VIDEO') || message.deletedAt) throw notFound('Arquivo não encontrado');
    const found = await this.deps.conversations.findMedia(messageId);
    if (!found) throw notFound('Arquivo não encontrado');
    return found;
  }

  /** Reage com um emoji da lista; mandar o mesmo de novo (ou `null`) tira a reação. */
  async react(actorId: string, conversationId: string, messageId: string, emoji: unknown): Promise<{ reactions: ReactionView[] }> {
    const { conversations, follows, clock } = this.deps;
    const { otherId } = await this.access(actorId, conversationId);
    if (emoji !== null && (typeof emoji !== 'string' || !(REACTIONS as readonly string[]).includes(emoji))) throw validationError('Reação inválida', { emoji: `Use uma destas: ${REACTIONS.join(' ')}` });
    const message = await this.visibleMessage(actorId, conversationId, messageId);
    if (message.deletedAt || message.kind === 'SYSTEM') throw notFound('Mensagem não encontrada');
    if (otherId && !(await follows.listFriendIds(actorId)).includes(otherId)) throw forbidden('Vocês não são mais amigos.');
    const current = (await conversations.listReactions([messageId])).find((r) => r.userId === actorId)?.emoji ?? null;
    await conversations.setReaction(messageId, actorId, emoji === current ? null : (emoji as string | null), clock.now());
    const rows = await conversations.listReactions([messageId]);
    return { reactions: groupReactions(rows, actorId).get(messageId) ?? [] };
  }

  /** Apaga a própria mensagem para todos (vira "Mensagem apagada"). Cartões do sistema, encontros e sugestões não se apagam. */
  async deleteMessage(actorId: string, conversationId: string, messageId: string): Promise<MessageView> {
    const { conversations, clock } = this.deps;
    await this.access(actorId, conversationId);
    const message = await this.visibleMessage(actorId, conversationId, messageId);
    if (message.senderId !== actorId) throw forbidden('Só quem enviou apaga a mensagem');
    if (!['TEXT', 'AUDIO', 'IMAGE', 'VIDEO', 'EVENT'].includes(message.kind)) throw validationError('Esta mensagem não pode ser apagada', { message: 'Só texto, áudio, foto, vídeo e evento' });
    const now = clock.now();
    if (!(await conversations.softDeleteMessage(messageId, now))) throw conflict('Esta mensagem já foi apagada');
    return toMessageView({ ...message, body: DELETED_BODY, deletedAt: now }, actorId);
  }

  /** Fixar no topo da lista e silenciar os avisos: só valem para quem pediu. */
  async setPreferences(actorId: string, conversationId: string, input: { pinned?: unknown; muted?: unknown }): Promise<{ pinned: boolean; muted: boolean }> {
    const { conversations, clock } = this.deps;
    await this.access(actorId, conversationId);
    if ((input.pinned !== undefined && typeof input.pinned !== 'boolean') || (input.muted !== undefined && typeof input.muted !== 'boolean')) throw validationError('Valor inválido', { pinned: 'Use verdadeiro ou falso' });
    if (input.pinned === undefined && input.muted === undefined) throw validationError('Nada para mudar', { pinned: 'Envie pinned e/ou muted' });
    const before = await conversations.getPrefs(conversationId, actorId);
    const patch: { pinnedAt?: Date | null; muted?: boolean } = {};
    if (input.pinned === true && before.pinnedAt === null) {
      if ((await conversations.countPinned(actorId)) >= PINNED_MAX) throw conflict(`Você pode fixar até ${PINNED_MAX} conversas. Solte uma para fixar esta.`);
      patch.pinnedAt = clock.now();
    }
    if (input.pinned === false) patch.pinnedAt = null;
    if (typeof input.muted === 'boolean') patch.muted = input.muted;
    await conversations.setPrefs(conversationId, actorId, patch);
    const after = await conversations.getPrefs(conversationId, actorId);
    return { pinned: after.pinnedAt !== null, muted: after.muted };
  }

  /** "Digitando…": sinal efêmero (some em poucos segundos) guardado só na memória do servidor. */
  async typing(actorId: string, conversationId: string): Promise<{ ok: true }> {
    await this.access(actorId, conversationId);
    this.typingUntil.set(`${conversationId}|${actorId}`, this.deps.clock.now().getTime() + TYPING_TTL_MS);
    return { ok: true };
  }

  private async typingNames(actorId: string, conversationId: string, memberIds: string[], hiddenIds: string[], now: Date): Promise<string[]> {
    const typists = memberIds.filter((id) => id !== actorId && !hiddenIds.includes(id) && (this.typingUntil.get(`${conversationId}|${id}`) ?? 0) > now.getTime());
    for (const [key, until] of this.typingUntil) if (until <= now.getTime()) this.typingUntil.delete(key);
    if (typists.length === 0) return [];
    return (await this.deps.users.findProfilesByIds(typists)).map((p) => p.displayName);
  }

  private async visibleMessage(actorId: string, conversationId: string, messageId: string): Promise<MessageRecord> {
    const message = typeof messageId === 'string' && messageId.length <= 64 ? await this.deps.conversations.findMessage(messageId) : undefined;
    if (!message || message.conversationId !== conversationId) throw notFound('Mensagem não encontrada');
    const cleared = await this.deps.conversations.getCleared(conversationId, actorId);
    if (cleared && message.createdAt <= cleared) throw notFound('Mensagem não encontrada');
    return message;
  }

  /** `replyToId` opcional: tem que ser uma mensagem de conteúdo desta conversa, ainda não apagada. */
  private async parseReply(conversationId: string, value: unknown): Promise<string | null> {
    if (value === undefined || value === null || value === '') return null;
    const target = typeof value === 'string' && value.length <= 64 ? await this.deps.conversations.findMessage(value) : undefined;
    if (!target || target.conversationId !== conversationId || target.deletedAt || target.kind === 'SYSTEM') throw notFound('Mensagem a responder não encontrada');
    return target.id;
  }

  /** Respostas (trecho da original) e reações de um grupo de mensagens. */
  private async decorate(actorId: string, items: MessageRecord[]): Promise<{ replies: Map<string, ReplyView>; reactions: Map<string, ReactionView[]> }> {
    const { conversations, users } = this.deps;
    const reactions = groupReactions(await conversations.listReactions(items.map((m) => m.id)), actorId);
    const replies = new Map<string, ReplyView>();
    const withReply = items.filter((m) => m.replyToId);
    if (withReply.length > 0) {
      const originals = new Map<string, MessageRecord>();
      for (const id of new Set(withReply.map((m) => m.replyToId as string))) {
        const found = items.find((m) => m.id === id) ?? (await conversations.findMessage(id));
        if (found) originals.set(id, found);
      }
      const names = new Map((await users.findProfilesByIds([...new Set([...originals.values()].map((m) => m.senderId))])).map((p) => [p.userId, p.displayName] as const));
      for (const m of withReply) {
        const o = originals.get(m.replyToId as string);
        if (!o) continue;
        replies.set(m.id, { id: o.id, senderName: names.get(o.senderId) ?? 'Alguém', mine: o.senderId === actorId, kind: o.kind, preview: previewOf(o), deleted: o.deletedAt != null });
      }
    }
    return { replies, reactions };
  }

  /** Bytes de uma mensagem de voz, só para quem está na conversa. */
  async audio(actorId: string, conversationId: string, messageId: string): Promise<{ mime: string; data: Uint8Array }> {
    await this.access(actorId, conversationId);
    const message = await this.deps.conversations.findMessage(messageId);
    if (!message || message.conversationId !== conversationId || message.kind !== 'AUDIO') throw notFound('Áudio não encontrado');
    const found = await this.deps.conversations.findAudio(messageId);
    if (!found) throw notFound('Áudio não encontrado');
    return found;
  }

  /** Avisa os outros membros (menos quem bloqueou ou foi bloqueado por quem escreveu). O texto da mensagem não vai no aviso. */
  private async notifyMembers(actorId: string, actorName: string, conversation: ConversationRecord, memberIds: string[], what: string): Promise<void> {
    const hidden = new Set(await this.deps.blocks.listRelatedIds(actorId));
    const muted = new Set(await this.deps.conversations.mutedUserIds(conversation.id));
    const title = conversation.type === 'GROUP' ? (conversation.name ?? 'Grupo') : actorName;
    const body = conversation.type === 'GROUP' ? `${actorName} ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
    for (const id of memberIds) {
      if (id === actorId || hidden.has(id) || muted.has(id)) continue;
      await this.deps.notifier.notify({ userId: id, type: 'MESSAGE', title, body, url: `/conversas/${conversation.id}`, dedupeKey: `msg:${conversation.id}` });
    }
  }

  /** Quem recebeu o cartão aceita ou recusa o lugar. Só uma resposta, só do destinatário, só entre amigos. */
  async respond(actorId: string, conversationId: string, messageId: string, action: unknown): Promise<MessageView> {
    if (action !== 'accept' && action !== 'decline') throw validationError('Ação inválida', { action: 'Use accept ou decline' });
    const { conversations, follows, clock } = this.deps;
    const { otherId } = await this.access(actorId, conversationId);
    if (!otherId) throw notFound('Sugestão não encontrada');
    const message = typeof messageId === 'string' && messageId.length <= 64 ? await conversations.findMessage(messageId) : undefined;
    if (!message || message.conversationId !== conversationId || message.kind !== 'SUGGESTION') throw notFound('Sugestão não encontrada');
    if (message.senderId === actorId) throw forbidden('Quem sugeriu não responde à própria sugestão');
    const friends = await follows.listFriendIds(actorId);
    if (!friends.includes(otherId)) throw forbidden('Vocês não são mais amigos.');
    const now = clock.now();
    const response = action === 'accept' ? 'ACCEPTED' : 'DECLINED';
    const saved = await conversations.setSuggestionResponse(messageId, response, now);
    if (!saved) throw conflict('Essa sugestão já foi respondida');
    const updated = { ...message, response, respondedAt: now } satisfies MessageRecord;
    const positions = await this.livePositions(actorId, otherId, now);
    return toMessageView(updated, actorId, { distances: updated.suggestion ? this.distancesOf(updated.suggestion, positions) : null });
  }

  async markRead(actorId: string, conversationId: string): Promise<{ ok: true }> {
    await this.access(actorId, conversationId);
    await this.deps.conversations.markRead(conversationId, actorId, this.deps.clock.now());
    return { ok: true };
  }

  /** Limpa a conversa só para você: as mensagens até agora somem para você e continuam para a outra pessoa. */
  async clear(actorId: string, conversationId: string): Promise<{ ok: true }> {
    await this.access(actorId, conversationId);
    await this.deps.conversations.setCleared(conversationId, actorId, this.deps.clock.now());
    return { ok: true };
  }

  /** Denuncia a conversa (ou a pessoa, na 1 a 1). Guarda as últimas mensagens de texto para a análise da equipe. */
  async report(actorId: string, conversationId: string, reason: unknown, details?: unknown): Promise<{ reported: true }> {
    const { conversations, ids, clock } = this.deps;
    const { otherId } = await this.access(actorId, conversationId);
    if (typeof reason !== 'string' || !(POST_REPORT_REASONS as readonly string[]).includes(reason)) throw validationError('Motivo inválido', { reason: 'Escolha um motivo da lista' });
    let text: string | null = null;
    if (details !== undefined && details !== null && details !== '') {
      if (typeof details !== 'string') throw validationError('Detalhes inválidos', { details: 'Detalhes inválidos' });
      text = details.trim() === '' ? null : details.trim();
      if (text !== null && text.length > CONVERSATION_REPORT_DETAILS_MAX) throw validationError('Detalhes longos demais', { details: `Use no máximo ${CONVERSATION_REPORT_DETAILS_MAX} caracteres` });
    }
    const recent = (await conversations.listMessages(conversationId, 20)).filter((m) => m.kind === 'TEXT');
    const evidence = recent.map((m) => `[${m.createdAt.toISOString()}] ${m.senderId === actorId ? 'quem denunciou' : otherId ? 'denunciado' : 'membro'}: ${m.body.replace(/\s+/g, ' ')}`).join('\n').slice(-4000);
    await conversations.addReport({ id: ids.next(), conversationId, reporterId: actorId, reportedUserId: otherId, reason: reason as PostReportReason, details: text, evidence, createdAt: clock.now() });
    return { reported: true };
  }

  /** Informações da conversa (1 a 1 ou grupo): encontros, links e mensagens de voz. */
  async shared(actorId: string, conversationId: string): Promise<SharedView> {
    const { conversations, users, meetups, blocks } = this.deps;
    const { conversation, other } = await this.access(actorId, conversationId);
    const hiddenIds = await blocks.listRelatedIds(actorId);
    const rows = await conversations.listShared(conversationId, SHARED_SCAN, hiddenIds, (await conversations.getCleared(conversationId, actorId)) ?? undefined);
    const names = new Map((await users.findProfilesByIds([...new Set(rows.map((r) => r.senderId))])).map((p) => [p.userId, p.displayName] as const));
    const links: SharedLink[] = [];
    const voice: SharedVoice[] = [];
    const media: SharedMedia[] = [];
    for (const m of rows) {
      if (m.deletedAt) continue;
      const base = { messageId: m.id, senderName: names.get(m.senderId) ?? 'Alguém', mine: m.senderId === actorId, createdAt: m.createdAt.toISOString() };
      if (m.kind === 'IMAGE' || m.kind === 'VIDEO') {
        media.push({ ...base, kind: m.kind });
        continue;
      }
      if (m.kind === 'AUDIO') {
        if (m.audioMs != null) voice.push({ ...base, durationMs: m.audioMs });
        continue;
      }
      for (const url of extractLinks(m.body)) links.push({ ...base, url });
    }
    const views = await buildMeetupViews(this.deps, actorId, await meetups.listForConversation(conversationId));
    return { type: conversation.type, other: other ? toPublicProfile(other) : null, name: conversation.name, imageUrl: conversation.imageUrl, meetups: views, links, voice, media };
  }

  /** Detalhes do grupo (tocar no nome): pessoas, eventos e mídia. Só quem está no grupo. */
  async group(actorId: string, conversationId: string): Promise<GroupDetails> {
    const { conversation, memberIds } = await this.access(actorId, conversationId);
    if (conversation.type !== 'GROUP' || conversation.name === null || conversation.ownerId === null) throw notFound('Grupo não encontrado');
    const hiddenIds = await this.deps.blocks.listRelatedIds(actorId);
    const visibleIds = memberIds.filter((id) => !hiddenIds.includes(id));
    const profiles = new Map((await this.deps.users.findProfilesByIds(visibleIds)).map((p) => [p.userId, p] as const));
    const ownerId = conversation.ownerId;
    const admins = new Set(await this.deps.conversations.adminIds(conversationId));
    const roleOf = (id: string): GroupRoleView => (id === ownerId ? 'OWNER' : admins.has(id) ? 'ADMIN' : 'MEMBER');
    const rank: Record<GroupRoleView, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
    const members: GroupDetails['members'] = [];
    for (const id of visibleIds) {
      const p = profiles.get(id);
      if (!p) continue;
      const follow = id === actorId ? undefined : await this.deps.follows.get(actorId, id);
      members.push({ profile: toPublicProfile(p), role: roleOf(id), follow: follow ? (follow.status === 'ACCEPTED' ? 'FOLLOWING' : 'PENDING') : 'NONE' });
    }
    members.sort((a, b) => (a.role === b.role ? a.profile.displayName.localeCompare(b.profile.displayName, 'pt-BR') : rank[a.role] - rank[b.role]));
    const meetups = await buildMeetupViews(this.deps, actorId, await this.deps.meetups.listForConversation(conversationId));
    return { id: conversationId, name: conversation.name, ownerId, imageUrl: conversation.imageUrl, members, canManage: roleOf(actorId) !== 'MEMBER', meetups, mediaAvailable: true };
  }

  // ---------- Gestão do grupo ----------

  /** Sai do grupo. Quem criou passa o grupo para quem entrou há mais tempo. */
  async leave(actorId: string, conversationId: string): Promise<{ ok: true }> {
    const { conversations, meetups, clock } = this.deps;
    const { conversation, memberIds } = await this.groupAccess(actorId, conversationId);
    const now = clock.now();
    const name = await this.nameOf(actorId);
    await this.postSystem(conversationId, actorId, `${name} saiu do grupo`, now);
    await conversations.removeParticipant(conversationId, actorId);
    await meetups.declineAllFor(conversationId, actorId, now);
    if (conversation.ownerId === actorId) {
      const next = memberIds.find((id) => id !== actorId);
      if (next) await conversations.updateGroup(conversationId, { ownerId: next });
    }
    return { ok: true };
  }

  /** Quem criou o grupo e os administradores removem membros; só o dono remove um administrador. A pessoa fica fora dos encontros do grupo; pode ser convidada de novo. */
  async removeMember(actorId: string, conversationId: string, targetId: unknown): Promise<{ ok: true }> {
    const { conversations, meetups, clock } = this.deps;
    const { conversation, memberIds } = await this.groupAccess(actorId, conversationId);
    const admins = await conversations.adminIds(conversationId);
    const actorIsOwner = conversation.ownerId === actorId;
    if (!actorIsOwner && !admins.includes(actorId)) throw forbidden('Só quem criou o grupo ou administra pode remover pessoas');
    if (typeof targetId !== 'string' || targetId.length > 64 || !memberIds.includes(targetId)) throw notFound('Essa pessoa não está no grupo');
    if (targetId === actorId) throw validationError('Para sair do grupo, use "Sair do grupo"');
    if (targetId === conversation.ownerId) throw forbidden('Quem criou o grupo não pode ser removido');
    if (!actorIsOwner && admins.includes(targetId)) throw forbidden('Só quem criou o grupo pode remover um administrador');
    const now = clock.now();
    await conversations.removeParticipant(conversationId, targetId);
    await meetups.declineAllFor(conversationId, targetId, now);
    await this.postSystem(conversationId, actorId, `${await this.nameOf(targetId)} foi removido(a) por ${await this.nameOf(actorId)}`, now);
    await this.deps.notifier.notify({ userId: targetId, type: 'GROUP_REMOVED', title: conversation.name ?? 'Grupo', body: 'Você foi removido(a) do grupo', url: '/conversas' });
    return { ok: true };
  }

  async renameGroup(actorId: string, conversationId: string, rawName: unknown): Promise<{ name: string }> {
    const { conversations, clock } = this.deps;
    const { conversation } = await this.groupAccess(actorId, conversationId);
    await this.requireManager(actorId, conversationId, conversation.ownerId, 'trocar o nome');
    if (typeof rawName !== 'string' || rawName.trim() === '' || Array.from(rawName.trim()).length > GROUP_NAME_MAX || CONTROL_CHARS_RE.test(rawName)) {
      throw validationError('Nome inválido', { name: `Use de 1 a ${GROUP_NAME_MAX} caracteres` });
    }
    const name = rawName.trim();
    await conversations.updateGroup(conversationId, { name });
    await this.postSystem(conversationId, actorId, `${await this.nameOf(actorId)} mudou o nome do grupo para "${name}"`, clock.now());
    return { name };
  }

  /** Troca ou remove (`null`) a foto do grupo. Só quem criou. A imagem chega já reduzida pelo app. */
  async setGroupPhoto(actorId: string, conversationId: string, image: unknown): Promise<{ imageUrl: string | null }> {
    const { conversations, clock } = this.deps;
    const { conversation } = await this.groupAccess(actorId, conversationId);
    await this.requireManager(actorId, conversationId, conversation.ownerId, 'trocar a foto');
    const imageUrl = image === null ? null : parseGroupImage(image);
    await conversations.updateGroup(conversationId, { imageUrl });
    await this.postSystem(conversationId, actorId, `${await this.nameOf(actorId)} ${imageUrl ? 'trocou' : 'removeu'} a foto do grupo`, clock.now());
    return { imageUrl };
  }

  /** Faz ou desfaz um administrador. Quem criou o grupo faz os dois; um administrador só promove membros. */
  async setAdmin(actorId: string, conversationId: string, targetId: unknown, admin: unknown): Promise<{ role: GroupRoleView }> {
    const { conversations, clock } = this.deps;
    const { conversation, memberIds } = await this.groupAccess(actorId, conversationId);
    if (typeof admin !== 'boolean') throw validationError('Informe se a pessoa deve ser administradora', { admin: 'true ou false' });
    const admins = await conversations.adminIds(conversationId);
    const actorIsOwner = conversation.ownerId === actorId;
    if (!actorIsOwner && !admins.includes(actorId)) throw forbidden('Só quem criou o grupo ou administra pode escolher administradores');
    if (typeof targetId !== 'string' || targetId.length > 64 || !memberIds.includes(targetId)) throw notFound('Essa pessoa não está no grupo');
    if (targetId === conversation.ownerId) throw validationError('Quem criou o grupo já tem todos os poderes');
    if (!admin && !actorIsOwner) throw forbidden('Só quem criou o grupo pode tirar um administrador');
    const already = admins.includes(targetId);
    if (admin !== already) {
      await conversations.setAdmin(conversationId, targetId, admin);
      const name = await this.nameOf(targetId);
      await this.postSystem(conversationId, actorId, admin ? `${name} agora é administrador(a) do grupo` : `${name} deixou de ser administrador(a) do grupo`, clock.now());
    }
    return { role: admin ? 'ADMIN' : 'MEMBER' };
  }

  private async requireManager(actorId: string, conversationId: string, ownerId: string | null, what: string): Promise<void> {
    if (ownerId === actorId) return;
    if ((await this.deps.conversations.adminIds(conversationId)).includes(actorId)) return;
    throw forbidden(`Só quem criou o grupo ou administra pode ${what}`);
  }

  private async groupAccess(actorId: string, conversationId: string) {
    const access = await this.access(actorId, conversationId);
    if (access.conversation.type !== 'GROUP') throw notFound('Grupo não encontrado');
    return access;
  }

  private async nameOf(userId: string): Promise<string> {
    return (await this.deps.users.findProfilesByIds([userId]))[0]?.displayName ?? 'Alguém';
  }

  private async postSystem(conversationId: string, senderId: string, body: string, now: Date): Promise<void> {
    const { conversations, ids } = this.deps;
    await conversations.addMessage({ id: ids.next(), conversationId, senderId, kind: 'SYSTEM', body, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: now });
  }

  /** Posições das duas pessoas num encontro Flash ativo entre elas, ou null. Nunca sai daqui: só serve para as distâncias. */
  private async livePositions(actorId: string, otherId: string, now: Date): Promise<{ me: { lat: number; lng: number }; them: { lat: number; lng: number } } | null> {
    const { flash } = this.deps;
    const open = await flash.listOpenInvitesFor(actorId, now);
    const match = open.find((i) => i.status === 'ACCEPTED' && (i.fromUserId === otherId || i.toUserId === otherId));
    if (!match) return null;
    const positions = await flash.listPositions(match.id);
    const me = positions.find((p) => p.userId === actorId);
    const them = positions.find((p) => p.userId === otherId);
    return me && them ? { me: { lat: me.lat, lng: me.lng }, them: { lat: them.lat, lng: them.lng } } : null;
  }

  private distancesOf(card: SuggestionCard, positions: { me: { lat: number; lng: number }; them: { lat: number; lng: number } } | null): MessageView['distances'] {
    if (!positions) return null;
    const at = { lat: card.lat, lng: card.lng };
    return { meM: Math.round(distanceMeters(at, positions.me)), themM: Math.round(distanceMeters(at, positions.them)) };
  }

  private parseLimit(value: unknown): number {
    if (value === undefined || value === null || value === '') return PAGE_DEFAULT;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n < 1) throw validationError('Limite inválido', { limit: 'Limite inválido' });
    return Math.min(n, PAGE_MAX);
  }

  /** Quem não participa vê "não encontrada"; na 1 a 1, bloqueio em qualquer sentido também. */
  private async access(actorId: string, conversationId: string) {
    const { conversations, blocks, users } = this.deps;
    const conversation = conversationId.length <= 64 ? await conversations.findById(conversationId) : undefined;
    const memberIds = conversation ? await conversations.participantIds(conversationId) : undefined;
    if (!conversation || !memberIds || !memberIds.includes(actorId)) throw notFound('Conversa não encontrada');
    if (conversation.type === 'GROUP') return { conversation, memberIds, otherId: null, other: null };
    const otherId = memberIds.find((id) => id !== actorId);
    if (!otherId) throw notFound('Conversa não encontrada');
    if (await blocks.existsEitherWay(actorId, otherId)) throw notFound('Conversa não encontrada');
    const [other] = await users.findProfilesByIds([otherId]);
    if (!other) throw notFound('Conversa não encontrada');
    return { conversation, memberIds, otherId, other };
  }
}
