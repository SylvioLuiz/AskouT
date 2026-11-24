import type { ConversationListItem, ConversationService, MessageView } from './conversation-service.ts';
import type { EventPageService } from './event-page-service.ts';
import type { FlashService } from './flash-service.ts';
import type { MeetupService } from './meetup-service.ts';
import type { CoreDeps } from './ports.ts';

/** Quantos planos vão para o widget (a agenda grande mostra até 5; o resto serve para a linha do tempo andar sozinha). */
export const WIDGET_PLANS_MAX = 12;
/** Quantos amigos com o NOW ligado vão com nome (o resto entra só na contagem). */
export const WIDGET_FRIENDS_MAX = 6;

/** Um plano da agenda pessoal: encontro confirmado ou evento com "Eu vou". */
export interface WidgetPlan {
  /** `m:<encontro>` ou `e:<evento>`, como na agenda do app. */
  key: string;
  kind: 'MEETUP' | 'EVENT';
  title: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  /** Tela do app que abre ao tocar. */
  url: string;
  /** Quantos confirmados (só nos encontros, contando quem organiza). */
  people: number | null;
}

/** Encontro do NOW aceito e ainda valendo (os dois combinaram de se ver agora). */
export interface WidgetNowMatch {
  id: string;
  withName: string;
  startedAt: string;
  expiresAt: string;
  /** Lugar escolhido no mapa; nulo enquanto ninguém escolheu. */
  placeName: string | null;
  url: string;
}

export interface WidgetFriend {
  name: string;
  username: string;
}

/**
 * Tudo o que os widgets da tela inicial e da tela bloqueada mostram, numa chamada só e sem posição de ninguém.
 * O widget escolhe, para cada instante da linha do tempo, o "encontro ativo" e o "próximo encontro" a partir de
 * `plans` e `matches`, então continua certo por horas sem buscar de novo.
 */
export interface WidgetSnapshot {
  /** Relógio do servidor. */
  now: string;
  /** Planos que ainda não terminaram, por início. */
  plans: WidgetPlan[];
  /** Encontros do NOW em andamento. */
  matches: WidgetNowMatch[];
  /** O seu NOW. */
  flash: { on: boolean; expiresAt: string | null };
  /** Amigos com o NOW ligado que você pode ver (os mesmos do raio no avatar), sem você. */
  friendsOnNow: { count: number; people: WidgetFriend[] };
  /** Convites do NOW esperando a sua resposta. */
  pendingInvites: number;
}

/** Quantas conversas vão para o widget de conversas (o grande mostra até 6). */
export const WIDGET_CHATS_MAX = 8;
/** Foto do grupo guardada no banco (data URL) só vai se for pequena; senão o widget usa as iniciais. */
const WIDGET_PHOTO_MAX = 150_000;
const WIDGET_PREVIEW_MAX = 120;

/** O que o widget de conversas mostra: só grupos, só conversas 1 a 1 (conversa com local conta como 1 a 1) ou tudo. */
export type WidgetChatsShow = 'all' | 'direct' | 'group';

/** Uma linha do widget de conversas, já pronta para desenhar (o widget não monta prévia). */
export interface WidgetChat {
  id: string;
  type: 'DIRECT' | 'GROUP';
  /** Nome da pessoa, do local (conversa com a página de um local) ou do grupo. */
  title: string;
  /** Até duas letras para o círculo quando não há foto. */
  initials: string;
  /** Foto (https ou data URL pequena); nula = iniciais. */
  photoUrl: string | null;
  /** Prévia da última mensagem, como na lista do app ("Você: …", "Ana: Foto", "Mensagem de voz (0:12)"). */
  preview: string;
  /** Quando foi a última mensagem; nulo sem mensagem. */
  at: string | null;
  unread: number;
  /** Silenciada: o número aparece apagado e não entra no total. */
  muted: boolean;
  pinned: boolean;
  /** Tela do app que abre ao tocar. */
  url: string;
}

export interface WidgetChatsSnapshot {
  now: string;
  show: WidgetChatsShow;
  /** Conversas não silenciadas com mensagem não lida dentro do filtro (como o número da aba em Conversas). */
  unreadChats: number;
  chats: WidgetChat[];
}

export function parseChatsShow(value: unknown): WidgetChatsShow {
  return value === 'direct' || value === 'group' ? value : 'all';
}

function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter((w) => w.length > 0);
  const picked = words.length > 1 ? [words[0] as string, words[words.length - 1] as string] : words;
  return picked.map((w) => Array.from(w)[0] ?? '').join('').toUpperCase() || '?';
}

function photoOf(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('https://')) return url.length <= 2048 ? url : null;
  return url.startsWith('data:image/') && url.length <= WIDGET_PHOTO_MAX ? url : null;
}

function clip(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  return chars.length > WIDGET_PREVIEW_MAX ? `${chars.slice(0, WIDGET_PREVIEW_MAX - 1).join('')}…` : chars.join('');
}

function voiceTime(ms: number): string {
  const total = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** O mesmo resumo da lista de conversas do app (apps/web/src/lib/chat.ts, previewOf). */
export function chatPreview(m: MessageView | null, senderName: string | null): string {
  if (!m) return 'Nenhuma mensagem ainda';
  const who = m.mine ? 'Você: ' : senderName ? `${senderName}: ` : '';
  if (m.deleted) return `${who}Mensagem apagada`;
  switch (m.kind) {
    case 'IMAGE':
      return `${who}Foto`;
    case 'VIDEO':
      return `${who}Vídeo`;
    case 'FILE':
      return clip(`${who}📎 ${m.body}`);
    case 'AUDIO':
      return `${who}Mensagem de voz${m.audio ? ` (${voiceTime(m.audio.durationMs)})` : ''}`;
    case 'SUGGESTION':
      return clip(m.suggestion ? `${who}Sugeriu ${m.suggestion.venueName}` : `${who}${m.body}`);
    case 'EVENT':
      return clip(`${who}Compartilhou ${m.event?.title ?? 'um evento'}`);
    default:
      return clip(`${who}${m.body}`);
  }
}

function firstName(displayName: string | null | undefined, username: string): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : username;
}

export class WidgetService {
  private readonly deps: CoreDeps;
  private readonly flash: FlashService;
  private readonly meetups: MeetupService;
  private readonly eventPages: EventPageService;
  private readonly conversations: ConversationService;

  constructor(deps: CoreDeps, services: { flash: FlashService; meetups: MeetupService; eventPages: EventPageService; conversations: ConversationService }) {
    this.deps = deps;
    this.flash = services.flash;
    this.meetups = services.meetups;
    this.eventPages = services.eventPages;
    this.conversations = services.conversations;
  }

  /**
   * Widget de conversas (como o do WhatsApp). Usa a mesma lista da aba Conversas (`inbox`): sem quem tem bloqueio
   * com você, sem solicitações de mensagem pendentes, fixadas primeiro e com as mesmas prévias.
   */
  async chats(actorId: string, rawShow?: unknown): Promise<WidgetChatsSnapshot> {
    const show = parseChatsShow(rawShow);
    const { items } = await this.conversations.inbox(actorId);
    const wanted = items.filter((c) => show === 'all' || (show === 'group' ? c.type === 'GROUP' : c.type !== 'GROUP'));
    const shown = wanted.slice(0, WIDGET_CHATS_MAX);
    // A lista não diz quem escreveu no grupo; o widget mostra "Ana: …", como o WhatsApp.
    const senderIds = [...new Set(shown.flatMap((c) => (c.type === 'GROUP' && c.lastMessage && !c.lastMessage.mine ? [c.lastMessage.senderId] : [])))];
    const senders = new Map((senderIds.length > 0 ? await this.deps.users.findProfilesByIds(senderIds) : []).map((p) => [p.userId, firstName(p.displayName, p.username)] as const));
    const row = (c: ConversationListItem): WidgetChat => {
      const venue = c.venue?.role === 'CUSTOMER' ? c.venue : null;
      const title = venue ? venue.name : c.other ? c.other.displayName || c.other.username : (c.name ?? 'Grupo');
      const sender = c.type === 'GROUP' && c.lastMessage ? (senders.get(c.lastMessage.senderId) ?? null) : null;
      return {
        id: c.id,
        type: c.type,
        title,
        initials: initialsOf(title),
        photoUrl: photoOf(venue ? venue.logoUrl : c.other ? c.other.avatarUrl : c.imageUrl),
        preview: chatPreview(c.lastMessage, sender),
        at: c.lastMessage?.createdAt ?? null,
        unread: c.unread,
        muted: c.muted,
        pinned: c.pinned,
        url: `/conversas/${c.id}`,
      };
    };
    return {
      now: this.deps.clock.now().toISOString(),
      show,
      unreadChats: wanted.filter((c) => c.unread > 0 && !c.muted).length,
      chats: shown.map(row),
    };
  }

  async snapshot(actorId: string): Promise<WidgetSnapshot> {
    const now = this.deps.clock.now();
    const nowMs = now.getTime();
    const [meetups, going, status, invites, activeIds, open] = await Promise.all([
      this.meetups.listMine(actorId),
      this.eventPages.listMyGoing(actorId),
      this.flash.status(actorId),
      this.flash.listInvites(actorId),
      this.flash.activeIds(actorId),
      this.deps.flash.listOpenInvitesFor(actorId, now),
    ]);

    // Mesma regra da agenda do app (apps/web/src/lib/agenda.ts, agendaEvents): encontro confirmado esconde o
    // "Eu vou" do mesmo evento.
    const mine = meetups.filter((m) => m.status === 'ACTIVE' && (m.myStatus === 'ORGANIZER' || m.myStatus === 'CONFIRMED'));
    const taken = new Set(mine.flatMap((m) => (m.eventRef ? [m.eventRef] : m.event ? [m.event.id] : [])));
    const plans: WidgetPlan[] = [
      ...mine.map((m) => ({
        key: `m:${m.id}`,
        kind: 'MEETUP' as const,
        title: m.title,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        venueName: m.event?.venueName ?? null,
        url: `/conversas/${m.conversationId}`,
        people: m.confirmedCount,
      })),
      ...going
        .filter((g) => !taken.has(g.id))
        .map((g) => ({ key: `e:${g.id}`, kind: 'EVENT' as const, title: g.title, startsAt: g.startsAt, endsAt: g.endsAt, venueName: g.venueName, url: `/eventos/${g.id}`, people: null })),
    ]
      .filter((p) => Date.parse(p.endsAt) > nowMs)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key))
      .slice(0, WIDGET_PLANS_MAX);

    const records = new Map(open.map((r) => [r.id, r] as const));
    const matches: WidgetNowMatch[] = invites.matches
      .filter((m) => Date.parse(m.expiresAt) > nowMs)
      .map((m) => {
        const record = records.get(m.id);
        return {
          id: m.id,
          withName: firstName(m.other.displayName, m.other.username),
          startedAt: (record?.respondedAt ?? record?.createdAt ?? now).toISOString(),
          expiresAt: m.expiresAt,
          placeName: record?.destination?.name ?? null,
          url: `/now/encontro/${m.id}`,
        };
      })
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

    const friendIds = activeIds.filter((id) => id !== actorId);
    const profiles = friendIds.length > 0 ? await this.deps.users.findProfilesByIds(friendIds.slice(0, WIDGET_FRIENDS_MAX)) : [];
    const people = profiles.map((p) => ({ name: firstName(p.displayName, p.username), username: p.username }));

    return {
      now: now.toISOString(),
      plans,
      matches,
      flash: { on: status.active, expiresAt: status.expiresAt },
      friendsOnNow: { count: friendIds.length, people },
      pendingInvites: invites.received.length,
    };
  }
}
