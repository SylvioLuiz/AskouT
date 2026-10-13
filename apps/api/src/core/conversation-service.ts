import { forbidden, notFound, rateLimited, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ConversationRecord, MessageRecord, PublicProfile, SuggestionCard } from './types.ts';
import { toPublicProfile } from './types.ts';

export const MESSAGE_MAX = 2000;
export const MESSAGES_PER_MINUTE = 30;
export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;

// Tudo menos tab, nova linha e retorno de carro.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export interface MessageView {
  id: string;
  senderId: string;
  mine: boolean;
  kind: 'TEXT' | 'SUGGESTION';
  body: string;
  suggestion: SuggestionCard | null;
  createdAt: string;
}

export interface ConversationListItem {
  id: string;
  other: PublicProfile;
  lastMessage: MessageView | null;
  unread: number;
  /** Só amigos conversam. Se deixaram de ser amigos, o histórico continua legível, mas sem enviar. */
  canSend: boolean;
}

export interface ConversationView {
  id: string;
  other: PublicProfile;
  canSend: boolean;
  /** Relógio do servidor. */
  now: string;
  /** Em ordem cronológica. */
  messages: MessageView[];
  hasMore: boolean;
}

export interface SendInput {
  body?: unknown;
  suggestion?: unknown;
}

function toMessageView(m: MessageRecord, actorId: string): MessageView {
  return {
    id: m.id,
    senderId: m.senderId,
    mine: m.senderId === actorId,
    kind: m.kind,
    body: m.body,
    suggestion: m.suggestion,
    createdAt: m.createdAt.toISOString(),
  };
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
  if (v.source !== 'EVENT' && v.source !== 'OSM') throw validationError('Sugestão inválida', { suggestion: 'Campo source inválido' });
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

export class ConversationService {
  private readonly deps: CoreDeps;

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

  /** Garante a conversa entre dois amigos (usado pelo Flash ao aceitar). Quem chama já checou amizade e bloqueio. */
  async ensureBetween(a: string, b: string): Promise<ConversationRecord> {
    return this.deps.conversations.getOrCreateDirect(a, b, this.deps.ids.next(), this.deps.clock.now());
  }

  async list(actorId: string): Promise<ConversationListItem[]> {
    const { conversations, follows, blocks, users } = this.deps;
    const [summaries, blocked, friends] = await Promise.all([
      conversations.listForUser(actorId),
      blocks.listRelatedIds(actorId),
      follows.listFriendIds(actorId),
    ]);
    const hidden = new Set(blocked);
    const visible = summaries
      .map((s) => ({ s, otherId: s.participantIds[0] === actorId ? s.participantIds[1] : s.participantIds[0] }))
      .filter(({ otherId }) => !hidden.has(otherId));
    const profiles = new Map((await users.findProfilesByIds(visible.map((v) => v.otherId))).map((p) => [p.userId, p] as const));
    const items: ConversationListItem[] = [];
    for (const { s, otherId } of visible) {
      const profile = profiles.get(otherId);
      if (!profile) continue;
      items.push({
        id: s.conversation.id,
        other: toPublicProfile(profile),
        lastMessage: s.lastMessage ? toMessageView(s.lastMessage, actorId) : null,
        unread: s.unread,
        canSend: friends.includes(otherId),
      });
    }
    return items;
  }

  /** Mensagens da conversa. A primeira página (sem `before`) também marca a conversa como lida. */
  async messages(actorId: string, conversationId: string, query: { limit?: unknown; before?: unknown } = {}): Promise<ConversationView> {
    const { conversations, clock } = this.deps;
    const { otherId, other } = await this.access(actorId, conversationId);
    const limit = this.parseLimit(query.limit);
    let before: Date | undefined;
    if (query.before !== undefined && query.before !== null && query.before !== '') {
      const parsed = typeof query.before === 'string' ? Date.parse(query.before) : Number.NaN;
      if (Number.isNaN(parsed)) throw validationError('Data inválida', { before: 'Data inválida' });
      before = new Date(parsed);
    }
    const now = clock.now();
    const page = await conversations.listMessages(conversationId, limit + 1, before);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(page.length - limit) : page;
    if (before === undefined) await conversations.markRead(conversationId, actorId, now);
    const friends = await this.deps.follows.listFriendIds(actorId);
    return {
      id: conversationId,
      other: toPublicProfile(other),
      canSend: friends.includes(otherId),
      now: now.toISOString(),
      messages: items.map((m) => toMessageView(m, actorId)),
      hasMore,
    };
  }

  async send(actorId: string, conversationId: string, input: SendInput): Promise<MessageView> {
    const { conversations, follows, clock, ids } = this.deps;
    const { otherId } = await this.access(actorId, conversationId);
    const hasText = input.body !== undefined && input.body !== null;
    const hasSuggestion = input.suggestion !== undefined && input.suggestion !== null;
    if (hasText === hasSuggestion) throw validationError('Envie um texto ou uma sugestão', { body: 'Envie um texto ou uma sugestão' });

    let kind: 'TEXT' | 'SUGGESTION' = 'TEXT';
    let body = '';
    let suggestion: SuggestionCard | null = null;
    if (hasSuggestion) {
      suggestion = parseSuggestion(input.suggestion);
      kind = 'SUGGESTION';
      body = `${suggestion.title} — ${suggestion.venueName}`;
    } else {
      body = parseText(input.body);
    }

    const friends = await follows.listFriendIds(actorId);
    if (!friends.includes(otherId)) throw forbidden('Vocês não são mais amigos. Não dá para enviar mensagens.');

    const now = clock.now();
    const recent = await conversations.countSentSince(actorId, new Date(now.getTime() - 60_000));
    if (recent >= MESSAGES_PER_MINUTE) throw rateLimited('Você está enviando mensagens rápido demais. Espere um instante.', 30);

    const message: MessageRecord = { id: ids.next(), conversationId, senderId: actorId, kind, body, suggestion, createdAt: now };
    await conversations.addMessage(message);
    await conversations.markRead(conversationId, actorId, now);
    return toMessageView(message, actorId);
  }

  async markRead(actorId: string, conversationId: string): Promise<{ ok: true }> {
    await this.access(actorId, conversationId);
    await this.deps.conversations.markRead(conversationId, actorId, this.deps.clock.now());
    return { ok: true };
  }

  private parseLimit(value: unknown): number {
    if (value === undefined || value === null || value === '') return PAGE_DEFAULT;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(n) || n < 1) throw validationError('Limite inválido', { limit: 'Limite inválido' });
    return Math.min(n, PAGE_MAX);
  }

  /** Quem não participa vê "não encontrada"; bloqueio em qualquer sentido também. */
  private async access(actorId: string, conversationId: string) {
    const { conversations, blocks, users } = this.deps;
    const pair = conversationId.length <= 64 ? await conversations.participantIds(conversationId) : undefined;
    if (!pair || !pair.includes(actorId)) throw notFound('Conversa não encontrada');
    const otherId = pair[0] === actorId ? pair[1] : pair[0];
    if (await blocks.existsEitherWay(actorId, otherId)) throw notFound('Conversa não encontrada');
    const [other] = await users.findProfilesByIds([otherId]);
    if (!other) throw notFound('Conversa não encontrada');
    return { otherId, other };
  }
}
