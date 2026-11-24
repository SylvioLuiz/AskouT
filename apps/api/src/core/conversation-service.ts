import { canOpenByInvite, recordCardInvites } from './event-invites.ts';
import { buildEventCards } from './event-card.ts';
import type { EventCardView } from './event-card.ts';
import { decodeAudioDataUrl, parseAudioDuration } from './audio.ts';
import { decodeImageDataUrl } from './image.ts';
import { parseChatFile, parseChatMedia } from './media.ts';
import type { ChatFile } from './media.ts';
import { commentEvidence, gifOf, parseCommentGif } from './gif.ts';
import type { CommentGif } from './gif.ts';
import type { ChatMedia } from './media.ts';
import { conflict, forbidden, notFound, rateLimited, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import { messageDelivery, requestRole } from './message-requests.ts';
import { canManageVenue } from './venue-access.ts';
import type { MessageDelivery, MessageRequestRole } from './message-requests.ts';
import { distanceMeters } from './geo.ts';
import { buildMeetupViews } from './meetup-view.ts';
import { SchedulingService } from './scheduling-service.ts';
import type { MeetupView } from './meetup-view.ts';
import type { StoryOverlay } from './story-overlays.ts';
import type { ConversationRecord, MessageKind, MessageReactionRecord, MessageRecord, PostReportReason, PublicProfile, SuggestionCard } from './types.ts';
import { DELETED_BODY, POST_REPORT_REASONS, toPublicProfile } from './types.ts';

export const MESSAGE_MAX = 2000;
export const MESSAGES_PER_MINUTE = 30;
export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 100;
export const GROUP_NAME_MAX = 60;
export const GROUP_IMAGE_MAX_BYTES = 40 * 1024;
/** Reações disponíveis. Uma por pessoa e mensagem; tocar na mesma tira. */
export const REACTIONS = ['❤️', '😂', '😮', '😢', '😡', '👍'] as const;
/** Um emoji só (com modificadores de tom, bandeiras e combinações com ZWJ). */
const EMOJI_RE = /^(?:\p{RI}\p{RI}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{EMod})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{EMod})?)*)$/u;
export function isEmoji(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 32 && EMOJI_RE.test(value);
}
/** Conversas fixadas por pessoa. */
export const PINNED_MAX = 5;
/** Cores que dá para escolher para uma conversa (só para você). Sem cor = a cor padrão do app. */
export const CHAT_COLORS = ['purple', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'graphite'] as const;
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
  /** Local compartilhado: texto com link da página do local (`…/bares/<id>`) vira cartão que abre a página no app. */
  venue: VenueCardView | null;
  /** Mensagem de voz (kind AUDIO): só a duração; o áudio vem de `GET .../messages/:id/audio`. */
  /**
   * `played`: em mensagem sua, alguém da conversa já ouviu; em mensagem de outra pessoa, você já ouviu
   * (o "ouvido" do WhatsApp/Instagram).
   */
  audio: { durationMs: number; played: boolean } | null;
  /** GIF (Giphy): mensagem de texto com `body` "GIF" e este anexo. */
  gif: CommentGif | null;
  /** Story respondido/reagido: a conversa mostra o story anexado. */
  storyId: string | null;
  /** O story respondido, enquanto ainda está no ar (null quando acabou): a conversa mostra e abre ao tocar. */
  story: MessageStoryView | null;
  /** Apagada por quem enviou: o conteúdo some para todos. */
  deleted: boolean;
  /** Mensagem a que esta responde. */
  replyTo: ReplyView | null;
  /** Reações agrupadas por emoji. */
  reactions: ReactionView[];
  /** Resposta de quem recebeu o cartão: aceitou ou recusou o lugar. */
  response: 'ACCEPTED' | 'DECLINED' | 'CANCELED' | null;
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
  /** Quem reagiu com este emoji (você primeiro, se reagiu). */
  people: { userId: string; name: string }[];
}

/** Outra pessoa da conversa e até quando ela leu (para o "Visto" e as fotos ao lado dos balões). */
export interface MemberReadView {
  profile: PublicProfile;
  readAt: string | null;
}

/** Conversa pela página de um local: quem escreveu (CUSTOMER) vê o local; o dono (OWNER) vê a pessoa e por qual local ela escreveu. */
export interface VenueChatView {
  id: string;
  name: string;
  logoUrl: string | null;
  role: 'CUSTOMER' | 'OWNER';
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
  /** Na 1 a 1, dá para enviar se a mensagem chega (ver `messageDelivery`); quem recebeu uma solicitação precisa aceitar antes. */
  canSend: boolean;
  /** Solicitação de mensagem pendente: INCOMING = alguém que você não segue escreveu; OUTGOING = você escreveu e a pessoa ainda não aceitou. */
  request: MessageRequestRole;
  /** Conversa pela página de um local (nula nas outras). */
  venue: VenueChatView | null;
  /** Fixada no topo da lista (só para você). */
  pinned: boolean;
  /** Sem avisos de mensagem nova (só para você). */
  muted: boolean;
  /** Você saiu do grupo (ou ele foi encerrado): dá para ler o que veio até aí e excluir a conversa, mas não enviar. */
  left: boolean;
  /** Grupo de amigos (entra por convite aceito, tem eventos do grupo). */
  community: boolean;
}

export interface ConversationView {
  id: string;
  type: 'DIRECT' | 'GROUP';
  other: PublicProfile | null;
  name: string | null;
  imageUrl: string | null;
  memberCount: number;
  canSend: boolean;
  /** Solicitação de mensagem pendente (ver `ConversationListItem.request`). */
  request: MessageRequestRole;
  /** Conversa pela página de um local (nula nas outras). */
  venue: VenueChatView | null;
  /** Você é quem criou o grupo (pode renomear, trocar a foto e remover pessoas). */
  isOwner: boolean;
  pinned: boolean;
  muted: boolean;
  /** Cor escolhida para a conversa (só para você); nula = cor padrão do app. */
  color: string | null;
  /** Nomes de quem está digitando agora. */
  typing: string[];
  /** As outras pessoas da conversa (sem você e sem quem tem bloqueio com você), com até quando leram. */
  members: MemberReadView[];
  /**
   * Até quando você tinha lido ANTES de abrir esta página (só na primeira página; nas antigas, nulo). O app põe a
   * divisória "Mensagens novas" logo depois disso. Nulo também se nunca leu.
   */
  myReadAt?: string | null;
  /** Relógio do servidor. */
  now: string;
  /** Em ordem cronológica. */
  messages: MessageView[];
  hasMore: boolean;
  /** Você saiu do grupo (ou ele foi encerrado): só leitura, até excluir a conversa. */
  left: boolean;
  /** Grupo de amigos (entra por convite aceito, tem eventos do grupo). */
  community: boolean;
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
  /** Foto do grupo (data URL), a capa do evento do grupo (endereço da imagem) quando ele não tem foto própria, ou nula. */
  imageUrl: string | null;
  /** O grupo tem foto própria (trocada no grupo). Falso quando mostra a capa do evento ou nada. */
  ownImage: boolean;
  /** Evento do grupo (o da votação de data ou o do encontro). Nulo em grupo comum. */
  event: GroupEventView | null;
  members: { profile: PublicProfile; role: GroupRoleView; follow: 'NONE' | 'PENDING' | 'FOLLOWING' }[];
  /** Você é o dono ou administrador: pode editar nome e foto e remover membros. */
  canManage: boolean;
  meetups: MeetupView[];
  /** Fotos e vídeos da conversa ficam na aba Mídia (`GET .../shared`). */
  mediaAvailable: true;
  /** Grupo de amigos: convites, eventos do grupo e "Criar evento no grupo" vêm de `GET /groups/:id`. */
  community: boolean;
}

/** Evento ao qual o grupo pertence. */
export interface GroupEventView {
  id: string;
  title: string;
  /** Capa do evento (endereço da imagem) ou nula. */
  coverUrl: string | null;
  /** Foto do post que é a capa, para trocar (`PUT /posts/:id/images/:imageId`). Só para quem criou o evento e só se a capa é uma foto enviada. */
  coverImageId: string | null;
  /** Você criou o evento e pode trocar a capa dele junto com a foto do grupo. */
  canEditCover: boolean;
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
  /** GIF da Giphy: `{ id, url }`, validado em `parseCommentGif`. */
  gif?: unknown;
  /** Responde a esta mensagem (junto de qualquer conteúdo). */
  replyToId?: unknown;
  /** Documento: `{mime, data, name}` (arquivo cru, como foto e vídeo). */
  file?: unknown;
  /** Uso interno (resposta/reação de story): anexa o story à mensagem. Nunca vem do corpo da requisição. */
  storyId?: string;
}

/** Story anexado a uma resposta: o que a conversa precisa para mostrar a miniatura e abrir o story. */
export interface MessageStoryView {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  caption: string | null;
  captionY: number | null;
  overlays?: StoryOverlay[];
  createdAt: string;
  expiresAt: string;
  /** Evento do story (as respostas e reações do visualizador usam). */
  eventId: string;
  /** Quem publicou o story. */
  author: PublicProfile;
}

interface ViewExtras {
  story?: MessageStoryView | null;
  distances?: MessageView['distances'];
  senderName?: string | null;
  meetup?: MeetupView | null;
  event?: EventCardView | null;
  venue?: VenueCardView | null;
  replyTo?: ReplyView | null;
  reactions?: ReactionView[];
  /** Quem já ouviu esta mensagem de voz. */
  playedBy?: readonly string[];
}

/** Link de evento do AskouT dentro de um texto (`…/eventos/<id>`). */
const EVENT_LINK_RE = /\/eventos\/([A-Za-z0-9_-]{1,64})(?![A-Za-z0-9_-])/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O evento de um link colado numa mensagem de texto (o primeiro), para a conversa mostrar o cartão
 * com foto, título e link, como num evento compartilhado pelo botão.
 */
export function linkedEventId(m: Pick<MessageRecord, 'kind' | 'body' | 'eventId' | 'postEventId'>): string | undefined {
  if (m.kind !== 'TEXT' || m.eventId || m.postEventId || !m.body) return undefined;
  const id = EVENT_LINK_RE.exec(m.body)?.[1];
  // Id de evento que não existe só fica sem cartão; UUID vale em maiúsculas ou minúsculas.
  return id && UUID_RE.test(id) ? id.toLowerCase() : id;
}

/** Cartão do local dentro da conversa: o suficiente para mostrar e abrir a página do local no app. */
export interface VenueCardView {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  coverUrl: string | null;
  logoUrl: string | null;
}

/** Link da página de um local do AskouT dentro de um texto (`…/bares/<id>`). */
const VENUE_LINK_RE = /\/(?:bares|locais)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![A-Za-z0-9_-])/i;

/** O local de um link colado numa mensagem de texto (o primeiro), quando a mensagem ainda não tem cartão de evento. */
export function linkedVenueId(m: Pick<MessageRecord, 'kind' | 'body' | 'eventId' | 'postEventId'>): string | undefined {
  if (m.kind !== 'TEXT' || m.eventId || m.postEventId || !m.body || linkedEventId(m)) return undefined;
  return VENUE_LINK_RE.exec(m.body)?.[1]?.toLowerCase();
}

async function buildVenueCards(deps: CoreDeps, ids: string[]): Promise<Map<string, VenueCardView>> {
  const found = await Promise.all([...new Set(ids)].map((id) => deps.places.findVenue(id)));
  return new Map(found.flatMap((v) => (v ? [[v.id, { id: v.id, name: v.name, category: v.category, address: v.address, coverUrl: v.coverUrl ?? null, logoUrl: v.logoUrl ?? null }] as const] : [])));
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
    body: gone ? '' : storyBody(m, actorId, extras.story ?? null),
    suggestion: gone ? null : m.suggestion,
    meetup: gone ? null : (extras.meetup ?? null),
    event: gone ? null : (extras.event ?? null),
    venue: gone ? null : (extras.venue ?? null),
    audio: !gone && m.kind === 'AUDIO' && m.audioMs ? { durationMs: m.audioMs, played: audioPlayed(m, actorId, extras.playedBy ?? []) } : null,
    gif: gone ? null : gifOf(m),
    storyId: gone ? null : (m.storyId ?? null),
    story: gone ? null : (extras.story ?? null),
    deleted: gone,
    replyTo: gone ? null : (extras.replyTo ?? null),
    reactions: gone ? [] : (extras.reactions ?? []),
    response: m.response,
    respondedAt: m.respondedAt ? m.respondedAt.toISOString() : null,
    distances: m.suggestion && !gone ? distances : null,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Resposta ou reação a um flash: o texto guardado fala com quem recebeu ("Respondeu ao seu flash: oi").
 * Com o flash ainda anexado, a resposta aparece só com o texto (a faixa em cima já explica). Depois que ele acaba,
 * quem recebeu lê "Respondeu ao seu flash: oi" e quem mandou, "Você respondeu ao flash: oi".
 */
function storyBody(m: MessageRecord, actorId: string, story: MessageStoryView | null): string {
  if (!m.storyId) return m.body;
  const reply = 'Respondeu ao seu flash: ';
  // Flash ainda anexado: a faixa em cima já diz quem respondeu a quem; o balão fica só com a resposta.
  if (story && m.body.startsWith(reply)) return m.body.slice(reply.length);
  if (m.senderId !== actorId) return m.body;
  for (const [prefix, yours] of [[reply, 'Você respondeu ao flash: '], ['Reagiu ao seu flash: ', 'Você reagiu ao flash: ']] as const) {
    if (m.body.startsWith(prefix)) return yours + m.body.slice(prefix.length);
  }
  return m.body;
}

function audioPlayed(m: MessageRecord, actorId: string, playedBy: readonly string[]): boolean {
  return m.senderId === actorId ? playedBy.some((id) => id !== actorId) : playedBy.includes(actorId);
}

const PREVIEW_BY_KIND: Partial<Record<MessageKind, string>> = { AUDIO: 'Mensagem de voz', IMAGE: 'Foto', VIDEO: 'Vídeo' };

function previewOf(m: MessageRecord): string {
  if (m.deletedAt) return '';
  return PREVIEW_BY_KIND[m.kind] ?? Array.from(m.body.replace(/\s+/g, ' ')).slice(0, REPLY_PREVIEW_MAX).join('');
}

function groupReactions(rows: MessageReactionRecord[], actorId: string, names: ReadonlyMap<string, string> = new Map()): Map<string, ReactionView[]> {
  const by = new Map<string, Map<string, ReactionView>>();
  for (const r of rows) {
    const perMessage = by.get(r.messageId) ?? new Map<string, ReactionView>();
    const cur = perMessage.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, people: [] };
    cur.count += 1;
    const person = { userId: r.userId, name: names.get(r.userId) ?? 'Alguém' };
    if (r.userId === actorId) {
      cur.mine = true;
      cur.people.unshift(person);
    } else cur.people.push(person);
    perMessage.set(r.emoji, cur);
    by.set(r.messageId, perMessage);
  }
  const order = (e: string) => {
    const i = REACTIONS.indexOf(e as (typeof REACTIONS)[number]);
    return i === -1 ? REACTIONS.length : i;
  };
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
  if (v.source !== 'EVENT' && v.source !== 'OSM' && v.source !== 'GOOGLE' && v.source !== 'PLACE') throw validationError('Sugestão inválida', { suggestion: 'Campo source inválido' });
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

const NEED_FOLLOW = 'Para mandar mensagem, siga a pessoa.';
/** O que acontece fora do chat quando um local é combinado: hoje, o lugar do encontro NOW. */
export interface PlaceAgreement {
  destinationAgreedInChat(actorId: string, otherId: string, place: { name: string; lat: number; lng: number }): Promise<void>;
  destinationWithdrawnInChat(actorId: string, otherId: string, place: { lat: number; lng: number }): Promise<void>;
}

const ACCEPT_FIRST = 'Aceite a solicitação de mensagem para responder.';

export class ConversationService {
  private readonly deps: CoreDeps;
  /** Quem está digitando: `conversa|pessoa` → instante em que o sinal expira. Fica só na memória (é efêmero). */
  private readonly typingUntil = new Map<string, number>();

  /** Avisado quando uma sugestão de local é aceita ou tem o aceite cancelado (o encontro NOW passa a ir para lá). */
  private readonly places: PlaceAgreement | undefined;

  constructor(deps: CoreDeps, places?: PlaceAgreement) {
    this.deps = deps;
    this.places = places;
  }

  /**
   * Abre (ou cria) a conversa 1 a 1. Com quem não segue você de volta, a conversa vira uma solicitação de mensagem
   * para a outra pessoa (ela aceita, recusa ou bloqueia). Conversa que já existe continua como está.
   */
  async open(actorId: string, otherId: unknown): Promise<{ id: string; request: MessageRequestRole }> {
    const { conversations, blocks, clock, ids } = this.deps;
    if (typeof otherId !== 'string' || otherId === '' || otherId.length > 64) throw validationError('Pessoa inválida', { userId: 'Pessoa inválida' });
    if (otherId === actorId) throw validationError('Você não pode conversar consigo mesmo');
    if (await blocks.existsEitherWay(actorId, otherId)) throw notFound('Pessoa não encontrada');
    const found = await conversations.findDirect(actorId, otherId);
    const existing = found ? await this.settle(found) : undefined;
    // Quem recebeu a solicitação abre a conversa normalmente (para aceitar ou recusar).
    if (existing?.requestToId === actorId) return { id: existing.id, request: 'INCOMING' };
    const delivery = await messageDelivery(this.deps, actorId, otherId, existing);
    if (delivery === 'NONE') throw forbidden(NEED_FOLLOW);
    const conversation = existing ?? (await conversations.getOrCreateDirect(actorId, otherId, ids.next(), clock.now()));
    return { id: conversation.id, request: delivery === 'REQUEST' ? 'OUTGOING' : null };
  }

  /**
   * Mensagem pela página de um local que tem dono: abre (ou cria) a conversa da pessoa com o local. Chega direto para o
   * dono, com aviso, sem virar solicitação. Fica separada da conversa pessoal entre os dois.
   */
  async openVenue(actorId: string, rawVenueId: unknown): Promise<{ id: string }> {
    const { conversations, places, blocks, clock, ids } = this.deps;
    const venue = typeof rawVenueId === 'string' && rawVenueId !== '' && rawVenueId.length <= 64 ? await places.findVenue(rawVenueId) : undefined;
    if (!venue) throw notFound('Local não encontrado');
    if (!venue.ownerId) throw forbidden('Este local ainda não tem ninguém administrando a página para responder mensagens');
    if (await canManageVenue(places, actorId, venue)) throw forbidden('Você administra este local: as mensagens dele chegam para você');
    if (await blocks.existsEitherWay(actorId, venue.ownerId)) throw notFound('Local não encontrado');
    const conversation = await conversations.getOrCreateVenueDirect(venue.id, actorId, venue.ownerId, ids.next(), clock.now());
    return { id: conversation.id };
  }

  /** Quem escreveu para o local, pela chave "venue:<local>:<cliente>". */
  private venueCustomerOf(conversation: ConversationRecord): string | null {
    return conversation.venueId && conversation.directKey?.startsWith('venue:') ? (conversation.directKey.split(':')[2] ?? null) : null;
  }

  private async venueViews(actorId: string, list: ConversationRecord[]): Promise<Map<string, VenueChatView>> {
    const out = new Map<string, VenueChatView>();
    const venueIds = [...new Set(list.flatMap((c) => (c.venueId ? [c.venueId] : [])))];
    const venues = new Map((await Promise.all(venueIds.map((id) => this.deps.places.findVenue(id)))).flatMap((v) => (v ? [[v.id, v] as const] : [])));
    for (const c of list) {
      const venue = c.venueId ? venues.get(c.venueId) : undefined;
      if (!venue) continue;
      out.set(c.id, { id: venue.id, name: venue.name, logoUrl: venue.logoUrl ?? null, role: this.venueCustomerOf(c) === actorId ? 'CUSTOMER' : 'OWNER' });
    }
    return out;
  }

  /**
   * Solicitação pendente que já não precisa ser solicitação (quem recebeu passou a seguir de volta ou abriu as mensagens
   * para qualquer pessoa) vira conversa normal.
   */
  private async settle(conversation: ConversationRecord): Promise<ConversationRecord> {
    if (conversation.type !== 'DIRECT' || !conversation.requestToId) return conversation;
    const recipientId = conversation.requestToId;
    const requesterId = (await this.deps.conversations.participantIds(conversation.id))?.find((id) => id !== recipientId);
    if (!requesterId) return conversation;
    const probe = { ...conversation, acceptedAt: null };
    if ((await messageDelivery(this.deps, requesterId, recipientId, probe)) !== 'DIRECT') return conversation;
    const now = this.deps.clock.now();
    await this.deps.conversations.setRequest(conversation.id, { requestToId: null, requestDeclinedAt: null, acceptedAt: now });
    return { ...conversation, requestToId: null, requestDeclinedAt: null, acceptedAt: now };
  }

  /** Pode enviar (ou reagir, responder cartões) na conversa 1 a 1? */
  private async directCanSend(actorId: string, conversation: ConversationRecord, otherId: string): Promise<boolean> {
    if (requestRole(conversation, actorId) === 'INCOMING') return false;
    return (await messageDelivery(this.deps, actorId, otherId, conversation)) !== 'NONE';
  }

  private async assertCanSend(actorId: string, conversation: ConversationRecord, otherId: string | null): Promise<MessageDelivery> {
    if (!otherId) return 'DIRECT';
    if (requestRole(conversation, actorId) === 'INCOMING') throw forbidden(ACCEPT_FIRST);
    const delivery = await messageDelivery(this.deps, actorId, otherId, conversation);
    if (delivery === 'NONE') throw forbidden(NEED_FOLLOW);
    return delivery;
  }

  /** Aceita a solicitação de mensagem: a conversa vai para a caixa normal e fica liberada nos dois sentidos. */
  async acceptRequest(actorId: string, conversationId: string): Promise<{ ok: true }> {
    const { conversation } = await this.access(actorId, conversationId);
    if (conversation.requestToId !== actorId) throw notFound('Solicitação não encontrada');
    await this.deps.conversations.setRequest(conversationId, { requestToId: null, requestDeclinedAt: null, acceptedAt: this.deps.clock.now() });
    return { ok: true };
  }

  /**
   * Recusa a solicitação: some das suas solicitações e as mensagens até agora são apagadas para você. Quem enviou não é
   * avisado. Se a pessoa escrever de novo, chega uma nova solicitação (só com as mensagens novas).
   */
  async declineRequest(actorId: string, conversationId: string): Promise<{ ok: true }> {
    const { conversation } = await this.access(actorId, conversationId);
    if (conversation.requestToId !== actorId) throw notFound('Solicitação não encontrada');
    const now = this.deps.clock.now();
    await this.deps.conversations.setRequest(conversationId, { requestDeclinedAt: now });
    await this.deps.conversations.setCleared(conversationId, actorId, now);
    return { ok: true };
  }

  /** Configuração de mensagens: perfil público pode receber mensagens de qualquer pessoa direto na caixa de conversas. */
  async messageSettings(actorId: string): Promise<{ openDms: boolean; isPrivate: boolean }> {
    const [profile] = await this.deps.users.findProfilesByIds([actorId]);
    return { openDms: await this.deps.conversations.getOpenDms(actorId), isPrivate: profile?.isPrivate ?? false };
  }

  async setMessageSettings(actorId: string, input: { openDms?: unknown }): Promise<{ openDms: boolean; isPrivate: boolean }> {
    if (typeof input.openDms !== 'boolean') throw validationError('Valor inválido', { openDms: 'Use true ou false' });
    await this.deps.conversations.setOpenDms(actorId, input.openDms);
    return this.messageSettings(actorId);
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

  /**
   * Grupo do evento, criado pela página do evento. Só quem criou o evento (de pessoa, não arquivado) cria. Se já existe
   * um grupo do evento em que você está, devolve ele. Entra direto só quem já aceitou ("Eu vou"), no máximo o limite do
   * grupo; convidado que ainda não respondeu entra sozinho quando aceitar. O cartão do evento fica no grupo.
   */
  async createEventGroup(actorId: string, rawPostId: unknown): Promise<{ id: string; created: boolean }> {
    const { conversations, blocks, posts, eventRoom, clock, ids } = this.deps;
    if (typeof rawPostId !== 'string' || rawPostId === '' || rawPostId.length > 64) throw notFound('Evento não encontrado');
    const post = (await posts.findById(rawPostId))?.post;
    if (!post || post.eventTitle === null || (post.archivedAt !== null && post.authorId !== actorId)) throw notFound('Evento não encontrado');
    if (post.authorId !== actorId) throw forbidden('Só quem criou o evento pode criar o grupo dele');
    if (post.archivedAt !== null) throw conflict('Este evento foi arquivado');
    for (const id of await conversations.groupIdsForEventPost(post.id)) {
      if (((await conversations.participantIds(id)) ?? []).includes(actorId)) return { id, created: false };
    }
    const hidden = new Set(await blocks.listRelatedIds(actorId));
    const going = (await eventRoom.listGoing({ source: 'USER', id: post.id })).map((g) => g.userId);
    const members = [...new Set(going)].filter((id) => id !== actorId && !hidden.has(id)).slice(0, GROUP_MAX_MEMBERS);
    const now = clock.now();
    const name = Array.from(post.eventTitle.trim() || 'Evento').slice(0, GROUP_NAME_MAX).join('');
    const group = await conversations.createGroup({ id: ids.next(), name, ownerId: actorId, now, eventPostId: post.id });
    for (const m of members) await conversations.addParticipant(group.id, m, now);
    const creator = await this.nameOf(actorId);
    await this.postSystem(group.id, actorId, `${creator} criou o grupo do evento`, now);
    // O cartão do evento no grupo dá acesso ao evento (privado inclusive) a quem está na conversa.
    await conversations.addMessage({ id: ids.next(), conversationId: group.id, senderId: actorId, kind: 'EVENT', body: `Evento: ${post.eventTitle}`, suggestion: null, response: null, respondedAt: null, meetupId: null, eventId: null, postEventId: post.id, createdAt: now });
    await conversations.markRead(group.id, actorId, now);
    if (members.length > 0) await this.notifyMembers(actorId, creator, group, members, 'adicionou você ao grupo do evento');
    return { id: group.id, created: true };
  }

  /** Garante a conversa entre dois amigos (usado pelo Flash ao aceitar). Quem chama já checou amizade e bloqueio. */
  async ensureBetween(a: string, b: string): Promise<ConversationRecord> {
    return this.deps.conversations.getOrCreateDirect(a, b, this.deps.ids.next(), this.deps.clock.now());
  }

  async list(actorId: string): Promise<ConversationListItem[]> {
    return (await this.inbox(actorId)).items;
  }

  /** Caixa de conversas e quantas solicitações de mensagem estão esperando (com mensagem nova não lida). */
  async inbox(actorId: string): Promise<{ items: ConversationListItem[]; requestCount: number; requestUnread: number }> {
    const all = await this.listItems(actorId);
    const requests = all.filter((i) => i.request === 'INCOMING');
    return { items: all.filter((i) => i.request !== 'INCOMING'), requestCount: requests.length, requestUnread: requests.filter((i) => i.unread > 0).length };
  }

  /** Solicitações de mensagem: conversas começadas por quem você não segue, esperando você aceitar, recusar ou bloquear. */
  async requests(actorId: string): Promise<ConversationListItem[]> {
    return (await this.listItems(actorId)).filter((i) => i.request === 'INCOMING');
  }

  private async listItems(actorId: string): Promise<ConversationListItem[]> {
    const { conversations, follows, blocks, users } = this.deps;
    const blocked = await blocks.listRelatedIds(actorId);
    const [summaries, friends] = await Promise.all([conversations.listForUser(actorId, blocked), follows.listFriendIds(actorId)]);
    const hidden = new Set(blocked);
    // Solicitações que já não precisam ser solicitação viram conversa normal.
    await Promise.all(summaries.filter((s) => s.conversation.requestToId).map(async (s) => (s.conversation = await this.settle(s.conversation))));
    const rows = summaries
      .map((s) => ({ s, otherId: s.conversation.type === 'DIRECT' ? (s.participantIds.find((id) => id !== actorId) ?? null) : null }))
      .filter(({ s, otherId }) => s.conversation.type === 'GROUP' || (otherId !== null && !hidden.has(otherId)))
      // "Apagar conversa" (1 a 1): some da lista até chegar mensagem nova. As mensagens continuam para a outra pessoa.
      .filter(({ s }) => !(s.conversation.type === 'DIRECT' && s.clearedAt != null && s.lastMessage === null))
      // Solicitação recebida: só aparece com mensagem, e some quando recusada (até chegar mensagem nova).
      .filter(({ s }) => requestRole(s.conversation, actorId) !== 'INCOMING' || (s.lastMessage !== null && !s.conversation.requestDeclinedAt));
    const friendSet = new Set(friends);
    const venueChats = await this.venueViews(actorId, rows.map(({ s }) => s.conversation));
    // Só amigos (o caso comum) dispensam a conferência de para onde a mensagem iria.
    const sendable = new Map(
      await Promise.all(
        rows
          .filter(({ s, otherId }) => s.conversation.type === 'DIRECT' && otherId !== null && !friendSet.has(otherId))
          .map(async ({ s, otherId }) => [s.conversation.id, await this.directCanSend(actorId, s.conversation, otherId as string)] as const),
      ),
    );
    const profiles = new Map((await users.findProfilesByIds(rows.flatMap((v) => (v.otherId ? [v.otherId] : [])))).map((p) => [p.userId, p] as const));
    const items: ConversationListItem[] = [];
    const pins = new Map<string, number>();
    // Grupo de evento sem foto própria mostra a capa do evento.
    const covers = new Map(
      await Promise.all(
        rows
          .filter(({ s }) => s.conversation.type === 'GROUP' && !s.conversation.imageUrl)
          .map(async ({ s }) => [s.conversation.id, (await this.groupEvent(s.conversation.id).catch(() => undefined))?.card.imageUrl ?? null] as const),
      ),
    );
    for (const { s, otherId } of rows) {
      const profile = otherId ? profiles.get(otherId) : undefined;
      if (s.conversation.type === 'DIRECT' && !profile) continue;
      items.push({
        id: s.conversation.id,
        type: s.conversation.type,
        other: profile ? toPublicProfile(profile) : null,
        name: s.conversation.name,
        imageUrl: s.conversation.imageUrl ?? covers.get(s.conversation.id) ?? null,
        memberCount: s.conversation.type === 'GROUP' ? s.participantIds.filter((id) => !hidden.has(id)).length : s.participantIds.length,
        lastMessage: s.lastMessage ? toMessageView(s.lastMessage, actorId) : null,
        unread: s.unread,
        canSend: s.conversation.type === 'GROUP' ? !s.leftAt : otherId !== null && (sendable.get(s.conversation.id) ?? (friendSet.has(otherId) && requestRole(s.conversation, actorId) !== 'INCOMING')),
        request: requestRole(s.conversation, actorId),
        venue: venueChats.get(s.conversation.id) ?? null,
        pinned: s.pinnedAt != null,
        muted: s.muted === true,
        left: s.leftAt != null,
        community: s.conversation.community === true,
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
    const { conversation, memberIds, otherId, other, leftAt } = await this.readAccess(actorId, conversationId);
    const limit = this.parseLimit(query.limit);
    let before: Date | undefined;
    if (query.before !== undefined && query.before !== null && query.before !== '') {
      const parsed = typeof query.before === 'string' ? Date.parse(query.before) : Number.NaN;
      if (Number.isNaN(parsed)) throw validationError('Data inválida', { before: 'Data inválida' });
      before = new Date(parsed);
    }
    // Quem saiu do grupo vê só o que veio até sair.
    const until = leftAt ? new Date(leftAt.getTime() + 1) : undefined;
    const firstPage = before === undefined;
    if (until && (before === undefined || before > until)) before = until;
    const now = clock.now();
    // Em grupo, quem tem bloqueio com você (nos dois sentidos) some do chat, como na conversa 1 a 1.
    const hiddenIds = conversation.type === 'GROUP' ? await this.deps.blocks.listRelatedIds(actorId) : [];
    const clearedAt = (await conversations.getCleared(conversationId, actorId)) ?? undefined;
    const page = await conversations.listMessages(conversationId, limit + 1, before, hiddenIds, clearedAt);
    const hasMore = page.length > limit;
    const items = hasMore ? page.slice(page.length - limit) : page;
    const myReadAt = firstPage ? ((await conversations.listReads(conversationId)).find((r) => r.userId === actorId)?.lastReadAt ?? null) : null;
    if (firstPage && !leftAt) await conversations.markRead(conversationId, actorId, now);
    const isGroup = conversation.type === 'GROUP';
    const request = requestRole(conversation, actorId);
    const canSend = isGroup ? !leftAt : otherId !== null && (await this.directCanSend(actorId, conversation, otherId));
    const positions = otherId && items.some((m) => m.suggestion) ? await this.livePositions(actorId, otherId, now) : null;

    const meetupIds = [...new Set(items.flatMap((m) => (m.meetupId ? [m.meetupId] : [])))];
    const records = (await Promise.all(meetupIds.map((id) => this.deps.meetups.find(id)))).filter((m) => m !== undefined);
    const meetupViews = new Map((await buildMeetupViews(this.deps, actorId, records)).map((v) => [v.id, v] as const));
    const eventCards = await buildEventCards(this.deps, [...new Set(items.flatMap((m) => (m.eventId ? [m.eventId] : m.postEventId ? [m.postEventId] : [linkedEventId(m)].filter((id): id is string => !!id))))]);
    const venueCards = await buildVenueCards(this.deps, items.flatMap((m) => [linkedVenueId(m)].filter((id): id is string => !!id)));
    // O cartão já chega marcado para quem confirmou presença antes de receber o evento na conversa.
    for (const [id, card] of eventCards) {
      card.going = card.ownerId === actorId || (await this.deps.eventRoom.isGoing({ source: card.userEvent ? 'USER' : 'PLACE', id }, actorId));
    }
    const names = isGroup ? new Map((await this.deps.users.findProfilesByIds([...new Set(items.map((m) => m.senderId))])).map((p) => [p.userId, p.displayName] as const)) : null;
    const decor = await this.decorate(actorId, items);
    const prefs = await conversations.getPrefs(conversationId, actorId);
    const reads = (await conversations.listReads(conversationId)).filter((r) => r.userId !== actorId && memberIds.includes(r.userId) && !hiddenIds.includes(r.userId));
    const readProfiles = new Map((other ? [other] : await this.deps.users.findProfilesByIds(reads.map((r) => r.userId))).map((p) => [p.userId, p] as const));
    const members: MemberReadView[] = reads.flatMap((r) => {
      const profile = readProfiles.get(r.userId);
      // Solicitação ainda não aceita: quem enviou não fica sabendo se a pessoa leu.
      const readAt = request === 'OUTGOING' ? null : r.lastReadAt ? r.lastReadAt.toISOString() : null;
      return profile ? [{ profile: toPublicProfile(profile), readAt }] : [];
    });

    return {
      id: conversationId,
      type: conversation.type,
      other: other ? toPublicProfile(other) : null,
      name: conversation.name,
      imageUrl: await this.groupImage(conversation),
      memberCount: memberIds.filter((id) => !hiddenIds.includes(id)).length,
      isOwner: conversation.ownerId === actorId,
      pinned: prefs.pinnedAt !== null,
      muted: prefs.muted,
      color: prefs.color,
      typing: leftAt ? [] : await this.typingNames(actorId, conversationId, memberIds, hiddenIds, now),
      members,
      myReadAt: myReadAt ? myReadAt.toISOString() : null,
      canSend,
      request,
      venue: (await this.venueViews(actorId, [conversation])).get(conversation.id) ?? null,
      now: now.toISOString(),
      messages: items.map((m) =>
        toMessageView(m, actorId, {
          distances: m.suggestion && otherId ? this.distancesOf(m.suggestion, positions) : null,
          senderName: names ? (names.get(m.senderId) ?? null) : null,
          meetup: m.meetupId ? (meetupViews.get(m.meetupId) ?? null) : null,
          event: eventCards.get((m.eventId ?? m.postEventId ?? linkedEventId(m)) as string) ?? null,
          venue: venueCards.get(linkedVenueId(m) ?? '') ?? null,
          replyTo: decor.replies.get(m.id) ?? null,
          reactions: decor.reactions.get(m.id) ?? [],
          playedBy: decor.plays.get(m.id) ?? [],
          story: m.storyId ? (decor.stories.get(m.storyId) ?? null) : null,
        }),
      ),
      hasMore,
      left: leftAt !== null,
      community: conversation.community === true,
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
    const hasGif = input.gif !== undefined && input.gif !== null;
    const hasFile = input.file !== undefined && input.file !== null;
    if ([hasText, hasSuggestion, hasEvent, hasAudio, hasMedia, hasGif, hasFile].filter(Boolean).length !== 1) throw validationError('Envie um texto, uma sugestão, um evento, um áudio, uma foto, um vídeo ou um arquivo', { body: 'Envie um texto, uma sugestão, um evento, um áudio, uma foto, um vídeo ou um arquivo' });
    if (hasSuggestion && conversation.type === 'GROUP') throw validationError('Sugestões de local só em conversas 1 a 1', { suggestion: 'Sugestões de local só em conversas 1 a 1' });

    let kind: MessageKind = 'TEXT';
    let body = '';
    let suggestion: SuggestionCard | null = null;
    let eventId: string | null = null;
    let postEventId: string | null = null;
    let eventCard: EventCardView | null = null;
    let audio: { mime: string; data: Uint8Array } | undefined;
    let media: ChatMedia | undefined;
    let audioMs: number | null = null;
    let gif: CommentGif | null = null;
    let file: ChatFile | undefined;
    if (hasFile) {
      const f = input.file as { mime?: unknown; data?: unknown; name?: unknown };
      file = parseChatFile(f.mime, f.data, f.name);
      kind = 'FILE';
      body = file.name;
    } else if (hasGif) {
      gif = parseCommentGif(input.gif);
      body = 'GIF';
    } else if (hasMedia) {
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
      eventCard.going = eventCard.ownerId === actorId || (await this.deps.eventRoom.isGoing({ source: eventCard.userEvent ? 'USER' : 'PLACE', id: eventCard.id }, actorId));
      if (eventCard.userEvent) {
        // Evento de pessoa: o dono envia; outros só reencaminham o que receberam, e nunca um evento privado.
        if (eventCard.ownerId !== actorId) {
          if (eventCard.private) throw forbidden('Este evento é privado: só quem criou pode enviar');
          if (!(await canOpenByInvite(this.deps, actorId, eventCard.id)) && !(await follows.get(actorId, eventCard.ownerId ?? ''))) throw notFound('Evento não encontrado');
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

    // 1 a 1: com quem não segue você de volta, a mensagem vira (ou continua) solicitação, sem aviso para a outra pessoa.
    const delivery = await this.assertCanSend(actorId, conversation, otherId);

    const now = clock.now();
    const recent = await conversations.countSentSince(actorId, new Date(now.getTime() - 60_000));
    if (recent >= MESSAGES_PER_MINUTE) throw rateLimited('Você está enviando mensagens rápido demais. Espere um instante.', 30);

    const replyToId = await this.parseReply(conversationId, input.replyToId);
    const message: MessageRecord = { id: ids.next(), conversationId, senderId: actorId, kind, body, suggestion, response: null, respondedAt: null, meetupId: null, eventId, postEventId, audioMs, replyToId, ...(input.storyId ? { storyId: input.storyId } : {}), ...(gif ? { gifId: gif.id, gifUrl: gif.url } : {}), createdAt: now };
    await conversations.addMessage(message, audio ?? (media ? { mime: media.mime, data: media.data } : file ? { mime: file.mime, data: file.data } : undefined));
    const asRequest = delivery === 'REQUEST' && otherId !== null;
    if (asRequest && (conversation.requestToId !== otherId || conversation.requestDeclinedAt)) {
      // Nova solicitação, ou recusada que volta com a mensagem nova.
      await conversations.setRequest(conversationId, { requestToId: otherId, requestDeclinedAt: null });
    }
    if (postEventId) {
      // Quem está na conversa vira convidado (fica registrado quem convidou; em evento privado, vira marcação).
      const eventPost = (await this.deps.posts.findById(postEventId))?.post;
      if (eventPost) await recordCardInvites(this.deps, actorId, eventPost, conversationId);
      // Evento com a data em votação: quem recebe de quem criou entra na votação.
      await new SchedulingService(this.deps).addEventInvitees(actorId, postEventId, conversationId);
    }
    this.typingUntil.delete(`${conversationId}|${actorId}`);
    await conversations.markRead(conversationId, actorId, now);
    const positions = suggestion && otherId ? await this.livePositions(actorId, otherId, now) : null;
    const actorProfile = (await this.deps.users.findProfilesByIds([actorId]))[0];
    const actorName = actorProfile?.username ?? 'Alguém';
    // Dentro da conversa aparece o nome real; o aviso (sino/push) usa só o usuário.
    const senderName = conversation.type === 'GROUP' ? (actorProfile?.displayName ?? actorName) : null;
    // Mensagem de texto: o aviso (sino/push) mostra um pedaço do que foi escrito; os outros tipos dizem o que foi enviado.
    const preview = kind === 'TEXT' && !gif ? messagePreview(body) : undefined;
    if (!asRequest) await this.notifyMembers(actorId, conversation.venueId ? await this.venueNoticeName(actorId, conversation, actorName) : actorName, conversation, memberIds, gif ? 'enviou um GIF' : audio ? 'enviou um áudio' : file ? 'enviou um arquivo' : media ? (media.kind === 'IMAGE' ? 'enviou uma foto' : 'enviou um vídeo') : eventCard ? 'compartilhou um evento' : suggestion ? 'sugeriu um local' : 'enviou uma mensagem', preview);
    const decor = await this.decorate(actorId, [message]);
    // Texto com link de evento: já volta com o cartão (como na lista de mensagens).
    const linked = linkedEventId(message);
    const linkCard = linked ? ((await buildEventCards(this.deps, [linked])).get(linked) ?? null) : null;
    const linkedVenue = linkedVenueId(message);
    const venueCard = linkedVenue ? ((await buildVenueCards(this.deps, [linkedVenue])).get(linkedVenue) ?? null) : null;
    return toMessageView(message, actorId, { distances: suggestion ? this.distancesOf(suggestion, positions) : null, senderName, event: eventCard ?? linkCard, venue: venueCard, replyTo: decor.replies.get(message.id) ?? null, story: message.storyId ? (decor.stories.get(message.storyId) ?? null) : null });
  }

  /** Bytes de uma foto, vídeo ou documento, só para quem está na conversa. Documento vem com o nome (para baixar). */
  async media(actorId: string, conversationId: string, messageId: string): Promise<{ mime: string; data: Uint8Array; name?: string }> {
    await this.access(actorId, conversationId);
    const message = typeof messageId === 'string' && messageId.length <= 64 ? await this.deps.conversations.findMessage(messageId) : undefined;
    if (!message || message.conversationId !== conversationId || (message.kind !== 'IMAGE' && message.kind !== 'VIDEO' && message.kind !== 'FILE') || message.deletedAt) throw notFound('Arquivo não encontrado');
    const found = await this.deps.conversations.findMedia(messageId);
    if (!found) throw notFound('Arquivo não encontrado');
    return message.kind === 'FILE' ? { ...found, name: message.body } : found;
  }

  /** Reage com qualquer emoji (um por pessoa); mandar o mesmo de novo (ou `null`) tira a reação. */
  async react(actorId: string, conversationId: string, messageId: string, emoji: unknown): Promise<{ reactions: ReactionView[] }> {
    const { conversations, clock } = this.deps;
    const { conversation, otherId } = await this.access(actorId, conversationId);
    if (emoji !== null && !isEmoji(emoji)) throw validationError('Reação inválida', { emoji: 'Use um emoji' });
    const message = await this.visibleMessage(actorId, conversationId, messageId);
    if (message.deletedAt || message.kind === 'SYSTEM') throw notFound('Mensagem não encontrada');
    await this.assertCanSend(actorId, conversation, otherId);
    const current = (await conversations.listReactions([messageId])).find((r) => r.userId === actorId)?.emoji ?? null;
    await conversations.setReaction(messageId, actorId, emoji === current ? null : (emoji as string | null), clock.now());
    const rows = await conversations.listReactions([messageId]);
    return { reactions: groupReactions(rows, actorId, await this.namesOf(rows.map((r) => r.userId))).get(messageId) ?? [] };
  }

  /** Apaga a própria mensagem para todos (vira "Mensagem apagada"). Cartões do sistema, encontros e sugestões não se apagam. */
  async deleteMessage(actorId: string, conversationId: string, messageId: string): Promise<MessageView> {
    const { conversations, clock } = this.deps;
    await this.access(actorId, conversationId);
    const message = await this.visibleMessage(actorId, conversationId, messageId);
    if (message.senderId !== actorId) throw forbidden('Só quem enviou apaga a mensagem');
    if (!['TEXT', 'AUDIO', 'IMAGE', 'VIDEO', 'FILE', 'EVENT'].includes(message.kind)) throw validationError('Esta mensagem não pode ser apagada', { message: 'Só texto, áudio, foto, vídeo, arquivo e evento' });
    const now = clock.now();
    if (!(await conversations.softDeleteMessage(messageId, now))) throw conflict('Esta mensagem já foi apagada');
    return toMessageView({ ...message, body: DELETED_BODY, deletedAt: now }, actorId);
  }

  /** Fixar no topo da lista, silenciar os avisos e a cor da conversa: só valem para quem pediu. */
  async setPreferences(actorId: string, conversationId: string, input: { pinned?: unknown; muted?: unknown; color?: unknown }): Promise<{ pinned: boolean; muted: boolean; color: string | null }> {
    const { conversations, clock } = this.deps;
    await this.access(actorId, conversationId);
    if ((input.pinned !== undefined && typeof input.pinned !== 'boolean') || (input.muted !== undefined && typeof input.muted !== 'boolean')) throw validationError('Valor inválido', { pinned: 'Use verdadeiro ou falso' });
    if (input.color !== undefined && input.color !== null && !(CHAT_COLORS as readonly unknown[]).includes(input.color)) throw validationError('Cor inválida', { color: 'Escolha uma das cores da lista' });
    if (input.pinned === undefined && input.muted === undefined && input.color === undefined) throw validationError('Nada para mudar', { pinned: 'Envie pinned, muted e/ou color' });
    const before = await conversations.getPrefs(conversationId, actorId);
    const patch: { pinnedAt?: Date | null; muted?: boolean; color?: string | null } = {};
    if (input.pinned === true && before.pinnedAt === null) {
      if ((await conversations.countPinned(actorId)) >= PINNED_MAX) throw conflict(`Você pode fixar até ${PINNED_MAX} conversas. Solte uma para fixar esta.`);
      patch.pinnedAt = clock.now();
    }
    if (input.pinned === false) patch.pinnedAt = null;
    if (typeof input.muted === 'boolean') patch.muted = input.muted;
    if (input.color !== undefined) patch.color = input.color as string | null;
    await conversations.setPrefs(conversationId, actorId, patch);
    const after = await conversations.getPrefs(conversationId, actorId);
    return { pinned: after.pinnedAt !== null, muted: after.muted, color: after.color };
  }

  /** "Digitando…": sinal efêmero (some em poucos segundos) guardado só na memória do servidor. */
  async typing(actorId: string, conversationId: string): Promise<{ ok: true }> {
    const { conversation } = await this.access(actorId, conversationId);
    if (requestRole(conversation, actorId) === 'INCOMING') return { ok: true };
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

  /** Nome de exibição de cada pessoa. */
  private async namesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return new Map();
    return new Map((await this.deps.users.findProfilesByIds(unique)).map((p) => [p.userId, p.displayName] as const));
  }

  /** Respostas (trecho da original) e reações de um grupo de mensagens. */
  private async decorate(actorId: string, items: MessageRecord[]): Promise<{ replies: Map<string, ReplyView>; reactions: Map<string, ReactionView[]>; plays: Map<string, string[]>; stories: Map<string, MessageStoryView> }> {
    const { conversations, users } = this.deps;
    // Stories respondidos que ainda estão no ar (o que acabou não aparece mais na conversa).
    const stories = new Map<string, MessageStoryView>();
    const storyIds = [...new Set(items.filter((m) => m.storyId && !m.deletedAt).map((m) => m.storyId as string))];
    if (storyIds.length > 0) {
      const now = this.deps.clock.now().getTime();
      const metas = (await Promise.all(storyIds.map((id) => this.deps.eventRoom.findStory(id)))).filter((r): r is NonNullable<typeof r> => r !== undefined && r.expiresAt.getTime() > now);
      const authors = new Map((await users.findProfilesByIds([...new Set(metas.map((r) => r.userId))])).map((p) => [p.userId, p] as const));
      for (const r of metas) {
        const author = authors.get(r.userId);
        if (!author) continue;
        const caption = r.caption ?? null;
        stories.set(r.id, {
          id: r.id,
          kind: r.video ? 'VIDEO' : 'IMAGE',
          caption,
          captionY: caption === null ? null : (r.captionY ?? 0.5),
          ...(r.overlays?.length ? { overlays: r.overlays } : {}),
          createdAt: r.createdAt.toISOString(),
          expiresAt: r.expiresAt.toISOString(),
          eventId: r.ref.id,
          author: toPublicProfile(author),
        });
      }
    }
    const plays = new Map<string, string[]>();
    const voiceIds = items.filter((m) => m.kind === 'AUDIO' && !m.deletedAt).map((m) => m.id);
    if (voiceIds.length > 0) {
      for (const p of await conversations.listAudioPlays(voiceIds)) plays.set(p.messageId, [...(plays.get(p.messageId) ?? []), p.userId]);
    }
    const reactionRows = await conversations.listReactions(items.map((m) => m.id));
    const reactions = groupReactions(reactionRows, actorId, await this.namesOf(reactionRows.map((r) => r.userId)));
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
    return { replies, reactions, plays, stories };
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

  /** Marca que você ouviu a mensagem de voz de outra pessoa (quem enviou passa a ver "ouvido"). Ouvir o próprio áudio não conta. */
  async audioPlayed(actorId: string, conversationId: string, messageId: string): Promise<{ played: true }> {
    await this.access(actorId, conversationId);
    const message = await this.visibleMessage(actorId, conversationId, messageId);
    if (message.kind !== 'AUDIO' || message.deletedAt) throw notFound('Áudio não encontrado');
    if (message.senderId !== actorId) await this.deps.conversations.markAudioPlayed(messageId, actorId, this.deps.clock.now());
    return { played: true };
  }

  /** No aviso da conversa pela página do local: o dono vê "@pessoa · Local"; quem escreveu vê o nome do local respondendo. */
  private async venueNoticeName(actorId: string, conversation: ConversationRecord, actorName: string): Promise<string> {
    const venue = conversation.venueId ? await this.deps.places.findVenue(conversation.venueId) : undefined;
    if (!venue) return actorName;
    return this.venueCustomerOf(conversation) === actorId ? `${actorName} · ${venue.name}` : venue.name;
  }

  /** Avisa os outros membros (menos quem bloqueou ou foi bloqueado por quem escreveu). O texto da mensagem não vai no aviso. */
  /** `preview`: trecho do texto da mensagem; quando vem, entra no lugar de "enviou uma mensagem". */
  private async notifyMembers(actorId: string, actorName: string, conversation: ConversationRecord, memberIds: string[], what: string, preview?: string): Promise<void> {
    const hidden = new Set(await this.deps.blocks.listRelatedIds(actorId));
    const muted = new Set(await this.deps.conversations.mutedUserIds(conversation.id));
    const title = conversation.type === 'GROUP' ? (conversation.name ?? 'Grupo') : actorName;
    const body = preview
      ? conversation.type === 'GROUP' ? `${actorName}: ${preview}` : preview
      : conversation.type === 'GROUP' ? `${actorName} ${what}` : what.charAt(0).toUpperCase() + what.slice(1);
    for (const id of memberIds) {
      if (id === actorId || hidden.has(id) || muted.has(id)) continue;
      // O aviso mostra a foto de quem escreveu (a lista troca pela de quem escreveu por último na conversa).
      await this.deps.notifier.notify({ userId: id, type: 'MESSAGE', title, body, url: `/conversas/${conversation.id}`, dedupeKey: `msg:${conversation.id}`, actorId });
    }
  }

  /**
   * Quem recebeu o cartão aceita ou recusa o lugar. Só uma resposta, só do destinatário, só entre amigos.
   * `cancel` desfaz um aceite (o cartão volta a esperar resposta).
   */
  async respond(actorId: string, conversationId: string, messageId: string, action: unknown): Promise<MessageView> {
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel' && action !== 'withdraw') throw validationError('Ação inválida', { action: 'Use accept, decline, cancel ou withdraw' });
    const { conversations, clock } = this.deps;
    const { conversation, otherId } = await this.access(actorId, conversationId);
    if (!otherId) throw notFound('Sugestão não encontrada');
    const message = typeof messageId === 'string' && messageId.length <= 64 ? await conversations.findMessage(messageId) : undefined;
    if (!message || message.conversationId !== conversationId || message.kind !== 'SUGGESTION') throw notFound('Sugestão não encontrada');
    const now = clock.now();
    if (action === 'withdraw') {
      // Só quem sugeriu cancela a própria sugestão (aberta ou já aceita); o cartão fica como "Sugestão cancelada".
      if (message.senderId !== actorId) throw forbidden('Só quem sugeriu pode cancelar a sugestão');
      const wasAccepted = message.response === 'ACCEPTED';
      if (!(await conversations.withdrawSuggestion(messageId, now))) throw conflict('Essa sugestão já foi recusada ou cancelada');
      if (wasAccepted && message.suggestion) await this.places?.destinationWithdrawnInChat(actorId, otherId, message.suggestion);
      const withdrawn = { ...message, response: 'CANCELED', respondedAt: now } satisfies MessageRecord;
      return toMessageView(withdrawn, actorId, { distances: null });
    }
    if (message.senderId === actorId) throw forbidden('Quem sugeriu não responde à própria sugestão');
    await this.assertCanSend(actorId, conversation, otherId);
    if (action === 'cancel') {
      if (!(await conversations.clearSuggestionResponse(messageId, 'ACCEPTED'))) throw conflict('Essa sugestão não está aceita');
      const reopened = { ...message, response: null, respondedAt: null } satisfies MessageRecord;
      if (message.suggestion) await this.places?.destinationWithdrawnInChat(actorId, otherId, message.suggestion);
      const positions = await this.livePositions(actorId, otherId, now);
      return toMessageView(reopened, actorId, { distances: reopened.suggestion ? this.distancesOf(reopened.suggestion, positions) : null });
    }
    const response = action === 'accept' ? 'ACCEPTED' : 'DECLINED';
    const saved = await conversations.setSuggestionResponse(messageId, response, now);
    if (!saved) throw conflict('Essa sugestão já foi respondida');
    const updated = { ...message, response, respondedAt: now } satisfies MessageRecord;
    if (response === 'ACCEPTED') {
      // Só um local aceito por vez: aceitar este cancela o aceite de qualquer sugestão anterior da conversa.
      const recent = await conversations.listMessages(conversationId, 200);
      for (const m of recent) {
        if (m.id !== messageId && m.kind === 'SUGGESTION' && m.response === 'ACCEPTED') await conversations.clearSuggestionResponse(m.id, 'ACCEPTED');
      }
    }
    if (response === 'ACCEPTED' && message.suggestion) await this.places?.destinationAgreedInChat(actorId, otherId, { name: message.suggestion.venueName, lat: message.suggestion.lat, lng: message.suggestion.lng });
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
    const evidence = recent.map((m) => `[${m.createdAt.toISOString()}] ${m.senderId === actorId ? 'quem denunciou' : otherId ? 'denunciado' : 'membro'}: ${commentEvidence(m.body.replace(/\s+/g, ' '), m.gifUrl, 2000)}`).join('\n').slice(-4000);
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
      // O nome de um documento não é link.
      if (m.kind === 'FILE') continue;
      for (const url of extractLinks(m.body)) links.push({ ...base, url });
    }
    const views = await buildMeetupViews(this.deps, actorId, await meetups.listForConversation(conversationId));
    return { type: conversation.type, other: other ? toPublicProfile(other) : null, name: conversation.name, imageUrl: await this.groupImage(conversation), meetups: views, links, voice, media };
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
    const found = await this.groupEvent(conversationId).catch(() => undefined);
    const event: GroupEventView | null = found
      ? (() => {
          const mine = found.card.userEvent === true && found.card.ownerId === actorId;
          const coverImageId = mine ? (/^\/posts\/images\/([\w-]+)$/.exec(found.card.imageUrl ?? '')?.[1] ?? null) : null;
          return { id: found.card.id, title: found.card.title, coverUrl: found.card.imageUrl, coverImageId, canEditCover: coverImageId !== null };
        })()
      : null;
    return { id: conversationId, name: conversation.name, ownerId, imageUrl: conversation.imageUrl ?? event?.coverUrl ?? null, ownImage: conversation.imageUrl !== null, event, members, canManage: roleOf(actorId) !== 'MEMBER', meetups, mediaAvailable: true, community: conversation.community === true };
  }

  // ---------- Gestão do grupo ----------

  /**
   * Sai do grupo. Quem criou passa o grupo para quem entrou há mais tempo.
   * Grupo de amigos (como no WhatsApp): sair não apaga a conversa. Ela fica na lista só para ler o que veio até sair,
   * até a pessoa excluir (`forget`); com `deleteChat: true`, sai e já exclui.
   */
  async leave(actorId: string, conversationId: string, rawDeleteChat?: unknown): Promise<{ ok: true }> {
    const { conversations, meetups, clock } = this.deps;
    const { conversation, memberIds } = await this.groupAccess(actorId, conversationId);
    if (rawDeleteChat !== undefined && rawDeleteChat !== null && typeof rawDeleteChat !== 'boolean') throw validationError('Valor inválido', { deleteChat: 'Use true ou false' });
    const now = clock.now();
    const name = await this.nameOf(actorId);
    await this.postSystem(conversationId, actorId, `${name} saiu do grupo`, now);
    if (conversation.community) {
      await conversations.markLeft(conversationId, actorId, now);
      if (rawDeleteChat === true) await conversations.forget(conversationId, actorId);
    } else {
      await conversations.removeParticipant(conversationId, actorId);
    }
    await meetups.declineAllFor(conversationId, actorId, now);
    await this.leaveGroupPolls(conversationId, actorId);
    if (conversation.ownerId === actorId) {
      const next = memberIds.find((id) => id !== actorId);
      if (next) await conversations.updateGroup(conversationId, { ownerId: next });
    }
    return { ok: true };
  }

  /** Quem sai do grupo sai também das votações de data ainda abertas nele (com os votos), e a contagem se ajusta. */
  private async leaveGroupPolls(conversationId: string, userId: string): Promise<void> {
    const { scheduling } = this.deps;
    for (const poll of await scheduling.listForConversation(conversationId)) {
      if (poll.status === 'VOTING' && poll.organizerId !== userId) await scheduling.removeParticipant(poll.id, userId);
    }
  }

  /** Exclui da sua lista a conversa de um grupo de que você já saiu (ou que foi encerrado). */
  async forget(actorId: string, conversationId: string): Promise<{ deleted: true }> {
    const conversation = conversationId.length <= 64 ? await this.deps.conversations.findById(conversationId) : undefined;
    if (!conversation || conversation.type !== 'GROUP' || !(await this.deps.conversations.leftAt(conversationId, actorId))) throw notFound('Conversa não encontrada');
    await this.deps.conversations.forget(conversationId, actorId);
    return { deleted: true };
  }

  /**
   * Apaga o grupo.
   * - Grupo de amigos: quem é o único administrador (o dono sem outros administradores, ou o último que sobrou)
   *   encerra o grupo. Todos deixam de fazer parte, mas cada um guarda o histórico e pode excluir a conversa depois.
   * - Outros grupos: só quem criou apaga, para todos. Os outros membros recebem um aviso.
   */
  async deleteGroup(actorId: string, conversationId: string): Promise<{ deleted: true }> {
    const { conversations } = this.deps;
    const { conversation, memberIds } = await this.groupAccess(actorId, conversationId);
    if (conversation.community) return this.endCommunity(actorId, conversation, memberIds);
    if (conversation.ownerId !== actorId) throw forbidden('Só quem criou o grupo pode apagá-lo. Você pode sair do grupo.');
    const title = conversation.name ?? 'Grupo';
    await conversations.deleteGroup(conversationId);
    for (const id of memberIds) {
      if (id === actorId) continue;
      await this.deps.notifier.notify({ userId: id, type: 'GROUP_REMOVED', title, body: 'O grupo foi apagado por quem criou', url: '/conversas' });
    }
    return { deleted: true };
  }

  private async endCommunity(actorId: string, conversation: ConversationRecord, memberIds: string[]): Promise<{ deleted: true }> {
    const { conversations, meetups, clock } = this.deps;
    const admins = await conversations.adminIds(conversation.id);
    const managers = new Set([...(conversation.ownerId && memberIds.includes(conversation.ownerId) ? [conversation.ownerId] : []), ...admins]);
    if (!managers.has(actorId)) throw forbidden('Só quem administra pode excluir o grupo. Você pode sair do grupo.');
    if (managers.size > 1) throw forbidden('Só dá para excluir o grupo quando você é o único administrador. Tire os outros administradores antes ou saia do grupo.');
    const now = clock.now();
    const title = conversation.name ?? 'Grupo';
    await this.postSystem(conversation.id, actorId, `${await this.nameOf(actorId)} excluiu o grupo`, now);
    for (const invite of await conversations.listGroupInvites(conversation.id)) {
      await conversations.removeGroupInvite(conversation.id, invite.userId);
      await this.deps.notifier.withdraw?.(invite.userId, `group-invite:${conversation.id}`);
    }
    for (const id of memberIds) {
      await meetups.declineAllFor(conversation.id, id, now);
      await conversations.markLeft(conversation.id, id, now);
      if (id !== actorId) await this.deps.notifier.notify({ userId: id, type: 'GROUP_REMOVED', title, body: 'O grupo foi excluído. As mensagens continuam com você até excluir a conversa.', url: `/conversas/${conversation.id}` });
    }
    await conversations.forget(conversation.id, actorId);
    return { deleted: true };
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
    // Grupo de amigos: quem é removido guarda o histórico até ali (como quem sai).
    if (conversation.community) await conversations.markLeft(conversationId, targetId, now);
    else await conversations.removeParticipant(conversationId, targetId);
    await meetups.declineAllFor(conversationId, targetId, now);
    await this.leaveGroupPolls(conversationId, targetId);
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

  /**
   * Quem criou o grupo e os administradores adicionam amigos seus (seguimento mútuo, sem bloqueio) que ainda não estão. Limite de 15 pessoas além de quem criou.
   * `shareHistory: false` esconde de quem entra as mensagens de antes (vê só o que vier depois); ausente ou true mostra tudo.
   * Grupo de amigos não usa esta rota: lá as pessoas são convidadas e só entram quando aceitam.
   */
  async addMembers(actorId: string, conversationId: string, userIds: unknown, rawShareHistory?: unknown): Promise<{ added: number }> {
    const { conversations, follows, blocks, clock } = this.deps;
    const { conversation, memberIds } = await this.groupAccess(actorId, conversationId);
    await this.requireManager(actorId, conversationId, conversation.ownerId, 'adicionar pessoas');
    if (conversation.community) throw conflict('Neste grupo as pessoas entram por convite: convide e elas entram quando aceitarem');
    const shareHistory = parseShareHistory(rawShareHistory);
    if (!Array.isArray(userIds) || userIds.length === 0) throw validationError('Escolha as pessoas', { userIds: 'Escolha ao menos uma pessoa' });
    const targets = [...new Set(userIds)];
    for (const t of targets) if (typeof t !== 'string' || t === '' || t.length > 64) throw validationError('Pessoa inválida', { userIds: 'Pessoa inválida' });
    const wanted = (targets as string[]).filter((t) => !memberIds.includes(t));
    if (wanted.length === 0) return { added: 0 };
    if (memberIds.length + wanted.length > GROUP_MAX_MEMBERS + 1) throw validationError(`O grupo comporta ${GROUP_MAX_MEMBERS + 1} pessoas`, { userIds: `O grupo comporta ${GROUP_MAX_MEMBERS + 1} pessoas` });
    const [friends, related] = await Promise.all([follows.listFriendIds(actorId), blocks.listRelatedIds(actorId)]);
    for (const t of wanted) {
      if (related.includes(t)) throw notFound('Pessoa não encontrada');
      if (!friends.includes(t)) throw forbidden('Só amigos podem entrar no grupo');
    }
    const now = clock.now();
    const actorName = await this.nameOf(actorId);
    for (const t of wanted) {
      await conversations.addParticipant(conversationId, t, now);
      if (!shareHistory) await hideHistoryFor(conversations, conversationId, t, now);
      await this.postSystem(conversationId, actorId, `${actorName} adicionou ${await this.nameOf(t)}`, now);
    }
    await this.notifyMembers(actorId, actorName, conversation, wanted, 'adicionou você ao grupo');
    // Grupo de um evento: quem entra é convidado para o evento. Falha aqui não desfaz a entrada no grupo.
    await this.inviteToGroupEvent(actorId, conversation, wanted, now).catch(() => undefined);
    return { added: wanted.length };
  }

  /**
   * Quem entra no grupo de um evento passa a fazer parte dele:
   * - o cartão do evento fica no grupo (é ele que dá acesso a um evento privado a quem está na conversa);
   * - se a data está em votação neste grupo, a pessoa entra na votação;
   * - recebe um convite: evento público, para tocar em "Eu vou"; privado, avisando que agora faz parte do evento.
   */
  private async inviteToGroupEvent(actorId: string, conversation: ConversationRecord, newIds: string[], now: Date): Promise<void> {
    const { conversations, scheduling, ids, notifier, users } = this.deps;
    const card = (await this.groupEvent(conversation.id))?.card;
    if (!card || newIds.length === 0) return;
    if (card.userEvent) {
      const ownerId = card.ownerId ?? actorId;
      const members = (await conversations.participantIds(conversation.id)) ?? [];
      const inGroup = async (senderId: string) => (await conversations.postEventConversationIds(card.id, senderId)).includes(conversation.id);
      if (!(await inGroup(ownerId)) && (ownerId === actorId || !(await inGroup(actorId)))) {
        // Em nome de quem criou o evento, se ainda está no grupo; senão, de quem adicionou.
        const senderId = members.includes(ownerId) ? ownerId : actorId;
        await conversations.addMessage({ id: ids.next(), conversationId: conversation.id, senderId, kind: 'EVENT', body: `Evento: ${card.title}`, suggestion: null, response: null, respondedAt: null, meetupId: null, eventId: null, postEventId: card.id, createdAt: now });
      }
      const poll = await scheduling.findByEventPost(card.id);
      if (poll && poll.status === 'VOTING' && poll.conversationId === conversation.id) {
        const inPoll = new Set((await scheduling.listParticipants(poll.id)).map((p) => p.userId));
        for (const userId of newIds) if (!inPoll.has(userId)) await scheduling.addParticipant(poll.id, userId, now);
      }
    }
    const datePending = card.startsAt === null;
    const body = card.private
      ? datePending
        ? 'Você agora faz parte deste evento privado. A data está em votação no grupo.'
        : 'Você agora faz parte deste evento privado. Veja os detalhes.'
      : datePending
        ? 'A data está em votação no grupo. Vote e depois toque em "Eu vou".'
        : 'Toque em "Eu vou" se você for.';
    // O aviso (sino e celular) mostra só o @usuário, como os outros.
    const who = (await users.findProfilesByIds([actorId]))[0]?.username ?? 'Alguém';
    for (const userId of newIds) {
      await notifier.notify({ userId, type: 'MEETUP_INVITE', title: `${who} convidou você para ${card.title}`, body, url: `/eventos/${card.id}`, dedupeKey: `group-event-invite:${card.id}`, actorId });
    }
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

  /**
   * Evento do grupo: o evento para o qual o grupo foi criado, o da votação de data que abriu o grupo (evento sem data) ou
   * o do encontro criado a partir de um evento. Votação cancelada e encontro cancelado não contam.
   */
  private async groupEvent(conversationId: string): Promise<{ card: EventCardView } | undefined> {
    const { scheduling, meetups, conversations } = this.deps;
    let eventId = (await conversations.findById(conversationId))?.eventPostId ?? null;
    if (!eventId) {
      const poll = (await scheduling.listForConversation(conversationId)).find((p) => p.status !== 'CANCELLED' && p.eventPostId);
      eventId = poll?.eventPostId ?? null;
    }
    if (!eventId) {
      const meetup = (await meetups.listForConversation(conversationId)).find((m) => m.status === 'ACTIVE' && (m.eventPostId || m.eventId));
      eventId = meetup ? (meetup.eventPostId ?? meetup.eventId) : null;
    }
    if (!eventId) return undefined;
    const card = (await buildEventCards(this.deps, [eventId])).get(eventId);
    return card ? { card } : undefined;
  }

  /** Foto que o grupo mostra: a própria ou, sem ela, a capa do evento do grupo. Conversa 1 a 1: a dela (nula). */
  private async groupImage(conversation: ConversationRecord): Promise<string | null> {
    if (conversation.imageUrl || conversation.type !== 'GROUP') return conversation.imageUrl;
    return (await this.groupEvent(conversation.id).catch(() => undefined))?.card.imageUrl ?? null;
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

  /** Como `access`, mas quem saiu do grupo guardando o histórico também lê (só até quando saiu: `leftAt`). */
  private async readAccess(actorId: string, conversationId: string) {
    try {
      return { ...(await this.access(actorId, conversationId)), leftAt: null as Date | null };
    } catch (failure) {
      const conversation = conversationId.length <= 64 ? await this.deps.conversations.findById(conversationId) : undefined;
      const leftAt = conversation?.type === 'GROUP' ? await this.deps.conversations.leftAt(conversationId, actorId) : null;
      if (!conversation || !leftAt) throw failure;
      const memberIds = (await this.deps.conversations.participantIds(conversationId)) ?? [];
      return { conversation, memberIds, otherId: null, other: null, leftAt };
    }
  }

  /** Quem não participa vê "não encontrada"; na 1 a 1, bloqueio em qualquer sentido também. */
  private async access(actorId: string, conversationId: string) {
    const { conversations, blocks, users } = this.deps;
    const conversation = conversationId.length <= 64 ? await conversations.findById(conversationId) : undefined;
    const memberIds = conversation ? await conversations.participantIds(conversationId) : undefined;
    if (!conversation || !memberIds || !memberIds.includes(actorId)) throw notFound('Conversa não encontrada');
    if (conversation.type === 'GROUP') return { conversation, memberIds, otherId: null, other: null };
    let members = memberIds;
    if (conversation.venueId) {
      // Conversa pela página do local: só quem escreveu e o dono atual (se o local trocou de dono, a conversa passa para o novo).
      const customerId = this.venueCustomerOf(conversation);
      const venue = await this.deps.places.findVenue(conversation.venueId);
      if (venue?.ownerId && customerId && venue.ownerId !== customerId && !members.includes(venue.ownerId)) {
        await conversations.getOrCreateVenueDirect(venue.id, customerId, venue.ownerId, this.deps.ids.next(), this.deps.clock.now());
        members = (await conversations.participantIds(conversationId)) ?? members;
      }
      if (actorId !== customerId && actorId !== venue?.ownerId) throw notFound('Conversa não encontrada');
    }
    const otherId = members.find((id) => id !== actorId);
    if (!otherId) throw notFound('Conversa não encontrada');
    if (await blocks.existsEitherWay(actorId, otherId)) throw notFound('Conversa não encontrada');
    const [other] = await users.findProfilesByIds([otherId]);
    if (!other) throw notFound('Conversa não encontrada');
    return { conversation: await this.settle(conversation), memberIds: members, otherId, other };
  }
}

/** "Compartilhar o histórico" ao colocar alguém num grupo: ausente vale sim (como sempre foi). */
export function parseShareHistory(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'boolean') throw validationError('Valor inválido', { shareHistory: 'Use true ou false' });
  return value;
}

/** Quem entra sem o histórico só vê as mensagens a partir de agora (o aviso de entrada, gravado em seguida, aparece). */
export async function hideHistoryFor(conversations: CoreDeps['conversations'], conversationId: string, userId: string, now: Date): Promise<void> {
  await conversations.setCleared(conversationId, userId, new Date(now.getTime() - 1));
}

/** Pedaço da mensagem para o aviso: uma linha só, até 100 caracteres (sem cortar emoji ao meio), com "…" se passar. */
export function messagePreview(text: string, max = 100): string | undefined {
  const line = text.replace(/\s+/g, ' ').trim();
  if (line === '') return undefined;
  const chars = Array.from(line);
  return chars.length <= max ? line : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}
