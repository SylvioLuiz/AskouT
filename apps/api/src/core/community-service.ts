import { buildEventCards } from './event-card.ts';
import type { EventCardView } from './event-card.ts';
import { hideHistoryFor, parseShareHistory } from './conversation-service.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ConversationRecord, PostRecord, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

/**
 * Grupos de amigos (turmas). Diferente do grupo de conversa comum e do grupo de um evento:
 * - quem cria convida amigos, e a pessoa só entra quando aceita o convite (pode recusar);
 * - a mesma pessoa pode estar em vários grupos;
 * - dentro do grupo se criam eventos: nascem privados e o convite já vai para todos do grupo;
 * - o evento pode virar público depois, mas o grupo continua fechado: o vínculo do evento com o grupo, os membros,
 *   a conversa e os outros eventos do grupo só aparecem para quem está no grupo;
 * - quem administra (dono e administradores) convida, remove e promove; qualquer um sai quando quiser (isso é a
 *   gestão de grupo da conversa, que vale igual aqui).
 * O grupo é a própria conversa de grupo (`community`), então mensagens, foto, nome e administradores são os mesmos.
 */

export const COMMUNITY_NAME_MAX = 60;
/** Pessoas no grupo de amigos, contando quem criou e os convites pendentes. */
export const COMMUNITY_MAX_MEMBERS = 50;
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** Convite que você recebeu para entrar num grupo. */
export interface CommunityInviteView {
  conversationId: string;
  name: string;
  imageUrl: string | null;
  memberCount: number;
  invitedBy: PublicProfile | null;
  createdAt: string;
}

/** Grupo de que você faz parte, para a lista "Meus grupos". */
export interface CommunitySummaryView {
  conversationId: string;
  name: string;
  imageUrl: string | null;
  memberCount: number;
  canManage: boolean;
  /** Próximo evento do grupo (ou o mais novo sem data), se houver. */
  nextEvent: EventCardView | null;
}

/** Convite pendente visto por quem administra o grupo. */
export interface CommunityPendingView {
  user: PublicProfile;
  invitedBy: PublicProfile | null;
  shareHistory: boolean;
  createdAt: string;
}

/** Página do grupo de amigos (só para quem está nele). */
export interface CommunityView {
  conversationId: string;
  name: string;
  imageUrl: string | null;
  memberCount: number;
  canManage: boolean;
  /** Convites ainda sem resposta (só quem administra vê). */
  pending: CommunityPendingView[];
  /** Eventos do grupo que ainda não acabaram (ou sem data), os mais próximos primeiro. */
  events: EventCardView[];
  /** Eventos do grupo que já acabaram, os mais recentes primeiro. */
  pastEvents: EventCardView[];
}

type Deps = CoreDeps;

/** O grupo de amigos (pela conversa) em que a pessoa está. Quem não está vê "não encontrado". */
async function communityOf(deps: Deps, actorId: string, rawId: unknown): Promise<{ conversation: ConversationRecord; memberIds: string[] }> {
  if (typeof rawId !== 'string' || rawId === '' || rawId.length > 64) throw notFound('Grupo não encontrado');
  const conversation = await deps.conversations.findById(rawId);
  const memberIds = conversation ? await deps.conversations.participantIds(rawId) : undefined;
  if (!conversation || conversation.type !== 'GROUP' || !conversation.community || !memberIds?.includes(actorId)) throw notFound('Grupo não encontrado');
  return { conversation, memberIds };
}

async function isManager(deps: Deps, conversation: ConversationRecord, userId: string): Promise<boolean> {
  return conversation.ownerId === userId || (await deps.conversations.adminIds(conversation.id)).includes(userId);
}

async function usernameOf(deps: Deps, userId: string): Promise<string> {
  return (await deps.users.findProfileById(userId))?.username ?? 'Alguém';
}

async function displayNameOf(deps: Deps, userId: string): Promise<string> {
  return (await deps.users.findProfilesByIds([userId]))[0]?.displayName ?? 'Alguém';
}

async function postSystem(deps: Deps, conversationId: string, senderId: string, body: string, now: Date): Promise<void> {
  await deps.conversations.addMessage({ id: deps.ids.next(), conversationId, senderId, kind: 'SYSTEM', body, suggestion: null, response: null, respondedAt: null, meetupId: null, createdAt: now });
}

/** Evento do grupo ainda vale para convidar quem entra: não arquivado e sem ter acabado (sem data também vale). */
function stillAhead(post: PostRecord, now: Date): boolean {
  if (post.archivedAt !== null || post.eventTitle === null) return false;
  const end = post.eventEndsAt ?? post.eventStartsAt;
  return end === null || end.getTime() > now.getTime();
}

/**
 * Criar evento dentro do grupo: confere que quem cria está no grupo de amigos. Devolve a conversa do grupo.
 * Usado pela criação de post (evento) com `groupId`.
 */
export async function communityForEvent(deps: Deps, actorId: string, rawGroupId: unknown): Promise<ConversationRecord> {
  return (await communityOf(deps, actorId, rawGroupId)).conversation;
}

/**
 * Depois de criar o evento no grupo: o cartão do evento vai para a conversa do grupo e todos do grupo
 * (menos quem criou e quem tem bloqueio com quem criou) recebem o convite, já com a marcação do evento privado.
 * A entrada no grupo de conversa do próprio evento continua só para quem aceita ("Eu vou").
 */
export async function shareGroupEvent(deps: Deps, actorId: string, conversation: ConversationRecord, post: { id: string; title: string }): Promise<string[]> {
  const { conversations, posts, blocks, clock, ids, notifier } = deps;
  const now = clock.now();
  await conversations.addMessage({ id: ids.next(), conversationId: conversation.id, senderId: actorId, kind: 'EVENT', body: `Evento: ${post.title}`, suggestion: null, response: null, respondedAt: null, meetupId: null, eventId: null, postEventId: post.id, createdAt: now });
  await conversations.markRead(conversation.id, actorId, now);
  const related = new Set(await blocks.listRelatedIds(actorId));
  const members = ((await conversations.participantIds(conversation.id)) ?? []).filter((id) => id !== actorId && !related.has(id));
  if (members.length === 0) return [];
  const added = await posts.addInvites(post.id, members, actorId, now);
  if (added.length > 0) await posts.createTags(post.id, added, now);
  const who = await usernameOf(deps, actorId);
  for (const userId of added) {
    await notifier.notify({ userId, type: 'MEETUP_INVITE', title: `${who} criou ${post.title} no grupo ${conversation.name ?? ''}`.trim(), body: 'Você foi convidado(a). Toque em "Eu vou" se você for.', url: `/eventos/${post.id}`, dedupeKey: `group-event-invite:${post.id}`, actorId });
  }
  return added;
}

/** Vínculo de um evento com o grupo de origem, só para quem está nesse grupo (para os outros o grupo não existe). */
export async function originGroupFor(deps: Deps, viewerId: string, post: Pick<PostRecord, 'originGroupId'>): Promise<{ conversationId: string; name: string } | null> {
  const id = post.originGroupId;
  if (!id) return null;
  const conversation = await deps.conversations.findById(id);
  if (!conversation || conversation.type !== 'GROUP' || !conversation.community) return null;
  if (!((await deps.conversations.participantIds(id)) ?? []).includes(viewerId)) return null;
  return { conversationId: id, name: conversation.name ?? '' };
}

export class CommunityService {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  /** Cria o grupo de amigos. Quem cria é o dono e já está dentro; os amigos escolhidos recebem convite. */
  async create(actorId: string, input: { name?: unknown; memberIds?: unknown; shareHistory?: unknown }): Promise<{ id: string; invited: number }> {
    const { conversations, clock, ids } = this.deps;
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (name === '' || CONTROL_CHARS_RE.test(name) || Array.from(name).length > COMMUNITY_NAME_MAX) throw validationError('Nome inválido', { name: `Use de 1 a ${COMMUNITY_NAME_MAX} caracteres` });
    const memberIds = input.memberIds === undefined || input.memberIds === null ? [] : input.memberIds;
    const targets = await this.validTargets(actorId, memberIds, [], 1);
    const now = clock.now();
    const group = await conversations.createGroup({ id: ids.next(), name, ownerId: actorId, now, community: true });
    await postSystem(this.deps, group.id, actorId, `${await displayNameOf(this.deps, actorId)} criou o grupo`, now);
    await conversations.markRead(group.id, actorId, now);
    const invited = await this.sendInvites(actorId, group, targets, parseShareHistory(input.shareHistory));
    return { id: group.id, invited: invited.length };
  }

  /** Grupos de amigos de que você faz parte, os com evento mais próximo primeiro. */
  async list(actorId: string): Promise<{ items: CommunitySummaryView[]; invites: CommunityInviteView[] }> {
    const { conversations, clock } = this.deps;
    const hidden = await this.deps.blocks.listRelatedIds(actorId);
    const summaries = (await conversations.listForUser(actorId, hidden)).filter((s) => s.conversation.type === 'GROUP' && s.conversation.community && !s.leftAt);
    const now = clock.now();
    const items: CommunitySummaryView[] = [];
    for (const s of summaries) {
      const c = s.conversation;
      const memberIds = (await conversations.participantIds(c.id)) ?? [];
      const ahead = (await this.deps.posts.listByOriginGroup(c.id)).map((r) => r.post).filter((p) => stillAhead(p, now));
      ahead.sort(byDateAsc);
      const next = ahead[0];
      const card = next ? ((await buildEventCards(this.deps, [next.id])).get(next.id) ?? null) : null;
      items.push({ conversationId: c.id, name: c.name ?? '', imageUrl: c.imageUrl, memberCount: memberIds.length, canManage: await isManager(this.deps, c, actorId), nextEvent: card });
    }
    items.sort((a, b) => {
      const at = a.nextEvent?.startsAt ? Date.parse(a.nextEvent.startsAt) : Number.POSITIVE_INFINITY;
      const bt = b.nextEvent?.startsAt ? Date.parse(b.nextEvent.startsAt) : Number.POSITIVE_INFINITY;
      return at - bt || a.name.localeCompare(b.name, 'pt-BR');
    });
    return { items, invites: await this.invites(actorId) };
  }

  /** Convites para grupos que você ainda não respondeu. */
  async invites(actorId: string): Promise<CommunityInviteView[]> {
    const { conversations, users, blocks } = this.deps;
    const hidden = new Set(await blocks.listRelatedIds(actorId));
    const out: CommunityInviteView[] = [];
    for (const invite of await conversations.listGroupInvitesForUser(actorId)) {
      const c = await conversations.findById(invite.conversationId);
      if (!c || c.type !== 'GROUP' || !c.community) continue;
      if (invite.invitedById && hidden.has(invite.invitedById)) continue;
      const by = invite.invitedById ? await users.findProfileById(invite.invitedById) : undefined;
      out.push({ conversationId: c.id, name: c.name ?? '', imageUrl: c.imageUrl, memberCount: ((await conversations.participantIds(c.id)) ?? []).length, invitedBy: by ? toPublicProfile(by) : null, createdAt: invite.createdAt.toISOString() });
    }
    return out;
  }

  /** Página do grupo: eventos (próximos e passados) e, para quem administra, os convites pendentes. */
  async get(actorId: string, rawId: unknown): Promise<CommunityView> {
    const { conversation, memberIds } = await communityOf(this.deps, actorId, rawId);
    const canManage = await isManager(this.deps, conversation, actorId);
    const now = this.deps.clock.now();
    const rows = (await this.deps.posts.listByOriginGroup(conversation.id)).map((r) => r.post).filter((p) => p.archivedAt === null && p.eventTitle !== null);
    const cards = await buildEventCards(this.deps, rows.map((p) => p.id));
    const ahead = rows.filter((p) => stillAhead(p, now)).sort(byDateAsc);
    const past = rows.filter((p) => !stillAhead(p, now)).sort((a, b) => byDateAsc(b, a));
    const pick = (list: PostRecord[]) => list.flatMap((p) => (cards.has(p.id) ? [cards.get(p.id) as EventCardView] : []));
    return {
      conversationId: conversation.id,
      name: conversation.name ?? '',
      imageUrl: conversation.imageUrl,
      memberCount: memberIds.length,
      canManage,
      pending: canManage ? await this.pendingViews(actorId, conversation.id) : [],
      events: pick(ahead),
      pastEvents: pick(past),
    };
  }

  /** Quem administra convida amigos seus. Ninguém entra direto: a pessoa recebe o convite e decide. */
  async invite(actorId: string, rawId: unknown, input: { userIds?: unknown; shareHistory?: unknown }): Promise<{ invited: number }> {
    const { conversation, memberIds } = await communityOf(this.deps, actorId, rawId);
    if (!(await isManager(this.deps, conversation, actorId))) throw forbidden('Só quem criou o grupo ou administra pode convidar pessoas');
    const pending = (await this.deps.conversations.listGroupInvites(conversation.id)).map((i) => i.userId);
    const targets = await this.validTargets(actorId, input.userIds, [...memberIds, ...pending], memberIds.length + pending.length, true);
    const invited = await this.sendInvites(actorId, conversation, targets, parseShareHistory(input.shareHistory));
    return { invited: invited.length };
  }

  /** Desfaz um convite pendente. Quem administra (qualquer convite) ou quem convidou. */
  async cancelInvite(actorId: string, rawId: unknown, userId: unknown): Promise<{ cancelled: true }> {
    const { conversation } = await communityOf(this.deps, actorId, rawId);
    if (typeof userId !== 'string' || userId === '' || userId.length > 64) throw notFound('Convite não encontrado');
    const invite = (await this.deps.conversations.listGroupInvites(conversation.id)).find((i) => i.userId === userId);
    if (!invite) throw notFound('Convite não encontrado');
    if (invite.invitedById !== actorId && !(await isManager(this.deps, conversation, actorId))) throw forbidden('Só quem administra o grupo ou quem convidou pode cancelar');
    await this.deps.conversations.removeGroupInvite(conversation.id, userId);
    await this.deps.notifier.withdraw?.(userId, `group-invite:${conversation.id}`);
    return { cancelled: true };
  }

  /**
   * Aceitar o convite: entra no grupo (com ou sem as mensagens de antes, como quem convidou escolheu) e passa a ser
   * convidado dos eventos do grupo que ainda não aconteceram.
   */
  async accept(actorId: string, rawId: unknown): Promise<{ id: string }> {
    const { conversations, blocks, posts, clock } = this.deps;
    const { conversation, invite } = await this.pendingFor(actorId, rawId);
    const memberIds = (await conversations.participantIds(conversation.id)) ?? [];
    if (conversation.ownerId && (await blocks.existsEitherWay(actorId, conversation.ownerId))) {
      await conversations.removeGroupInvite(conversation.id, actorId);
      throw notFound('Convite não encontrado');
    }
    if (memberIds.length >= COMMUNITY_MAX_MEMBERS) throw conflict('O grupo está cheio');
    const now = clock.now();
    await conversations.removeGroupInvite(conversation.id, actorId);
    if (!memberIds.includes(actorId)) {
      await conversations.addParticipant(conversation.id, actorId, now);
      if (!invite.shareHistory) await hideHistoryFor(conversations, conversation.id, actorId, now);
      await postSystem(this.deps, conversation.id, actorId, `${await displayNameOf(this.deps, actorId)} aceitou o convite e entrou no grupo`, now);
    }
    await this.deps.notifier.withdraw?.(actorId, `group-invite:${conversation.id}`);
    // Eventos do grupo ainda pela frente: a pessoa vira convidada (sem aviso a mais; o cartão está na conversa).
    for (const { post } of await posts.listByOriginGroup(conversation.id)) {
      if (!stillAhead(post, now) || post.authorId === actorId) continue;
      if (await blocks.existsEitherWay(actorId, post.authorId)) continue;
      const added = await posts.addInvites(post.id, [actorId], post.authorId, now);
      if (added.length > 0 && post.eventPrivate) await posts.createTags(post.id, added, now);
    }
    return { id: conversation.id };
  }

  /** Recusar: o convite some (a pessoa pode ser convidada de novo). */
  async decline(actorId: string, rawId: unknown): Promise<{ declined: true }> {
    const { conversation } = await this.pendingFor(actorId, rawId);
    await this.deps.conversations.removeGroupInvite(conversation.id, actorId);
    await this.deps.notifier.withdraw?.(actorId, `group-invite:${conversation.id}`);
    return { declined: true };
  }

  private async pendingFor(actorId: string, rawId: unknown) {
    if (typeof rawId !== 'string' || rawId === '' || rawId.length > 64) throw notFound('Convite não encontrado');
    const conversation = await this.deps.conversations.findById(rawId);
    const invite = conversation ? (await this.deps.conversations.listGroupInvites(rawId)).find((i) => i.userId === actorId) : undefined;
    if (!conversation || conversation.type !== 'GROUP' || !conversation.community || !invite) throw notFound('Convite não encontrado');
    return { conversation, invite };
  }

  private async pendingViews(actorId: string, conversationId: string): Promise<CommunityPendingView[]> {
    const hidden = new Set(await this.deps.blocks.listRelatedIds(actorId));
    const rows = (await this.deps.conversations.listGroupInvites(conversationId)).filter((r) => !hidden.has(r.userId));
    const ids = [...new Set(rows.flatMap((r) => [r.userId, ...(r.invitedById ? [r.invitedById] : [])]))];
    const byId = new Map((await this.deps.users.findProfilesByIds(ids)).map((p) => [p.userId, toPublicProfile(p)] as const));
    return rows.flatMap((r) => {
      const user = byId.get(r.userId);
      return user ? [{ user, invitedBy: r.invitedById ? (byId.get(r.invitedById) ?? null) : null, shareHistory: r.shareHistory, createdAt: r.createdAt.toISOString() }] : [];
    });
  }

  /** Amigos (seguimento mútuo, sem bloqueio) de quem convida, sem quem já está ou já foi convidado, dentro do limite. */
  private async validTargets(actorId: string, raw: unknown, skip: string[], occupied: number, requireOne = false): Promise<string[]> {
    if (!Array.isArray(raw) || (requireOne && raw.length === 0)) throw validationError('Escolha as pessoas', { userIds: 'Escolha ao menos uma pessoa' });
    for (const t of raw) if (typeof t !== 'string' || t === '' || t.length > 64) throw validationError('Pessoa inválida', { userIds: 'Pessoa inválida' });
    const wanted = [...new Set(raw as string[])].filter((t) => t !== actorId && !skip.includes(t));
    if (occupied + wanted.length > COMMUNITY_MAX_MEMBERS) throw validationError(`O grupo comporta ${COMMUNITY_MAX_MEMBERS} pessoas`, { userIds: `O grupo comporta ${COMMUNITY_MAX_MEMBERS} pessoas, contando os convites pendentes` });
    const [friends, related] = await Promise.all([this.deps.follows.listFriendIds(actorId), this.deps.blocks.listRelatedIds(actorId)]);
    for (const t of wanted) {
      if (related.includes(t)) throw notFound('Pessoa não encontrada');
      if (!friends.includes(t)) throw forbidden('Só dá para convidar amigos (quem segue você e que você segue)');
    }
    return wanted;
  }

  private async sendInvites(actorId: string, conversation: ConversationRecord, targets: string[], shareHistory: boolean): Promise<string[]> {
    const { conversations, clock, notifier } = this.deps;
    const now = clock.now();
    const invited: string[] = [];
    for (const t of targets) if (await conversations.addGroupInvite(conversation.id, t, actorId, now, shareHistory)) invited.push(t);
    const who = await usernameOf(this.deps, actorId);
    for (const userId of invited) {
      await notifier.notify({ userId, type: 'MEETUP_INVITE', title: `${who} convidou você para o grupo ${conversation.name ?? ''}`.trim(), body: 'Aceite para entrar no grupo e receber os eventos dele.', url: '/grupos', dedupeKey: `group-invite:${conversation.id}`, actorId });
    }
    return invited;
  }
}

/** Mais cedo primeiro; sem data vai para o fim (o mais novo primeiro entre eles). */
function byDateAsc(a: PostRecord, b: PostRecord): number {
  const at = a.eventStartsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const bt = b.eventStartsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  return b.createdAt.getTime() - a.createdAt.getTime();
}
