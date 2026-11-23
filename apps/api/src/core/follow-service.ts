import { conflict, forbidden, notFound, validationError } from './errors.ts';
import { evaluateFriendship } from './friendship.ts';
import type { CoreDeps } from './ports.ts';
import { PEOPLE_MAX_ATTENDEES_PER_EVENT, PEOPLE_MAX_EVENTS, PEOPLE_MAX_FOLLOWERS, PEOPLE_MAX_FRIENDS, PEOPLE_MAX_ITEMS, scorePerson } from './people-suggestions.ts';
import type { PeopleReason, PeopleSignals } from './people-suggestions.ts';
import type { Direction, FollowStatus, Page, Profile, PublicProfile } from './types.ts';
import { MAX_PAGE_LIMIT, normalizePage, toPublicProfile } from './types.ts';

const CONTACT_HASHES_MAX = 500;
/** Celulares da agenda: o app do celular lê a agenda inteira, então cabe mais. */
const CONTACT_PHONE_HASHES_MAX = 3000;

/** Códigos SHA-256 (hex), em minúsculas e sem repetir. */
function cleanHashes(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw validationError('Contatos inválidos', { [field]: `Envie até ${max} contatos` });
  const clean = [...new Set(value.map((h) => (typeof h === 'string' ? h.toLowerCase() : '')))];
  if (clean.some((h) => !/^[0-9a-f]{64}$/.test(h))) throw validationError('Contatos inválidos', { [field]: 'Formato inválido' });
  return clean;
}

export interface FollowResult {
  status: FollowStatus;
  isFriend: boolean;
}

/** Sugestão de pessoa: o perfil, os sinais que a trouxeram e o motivo principal (o app mostra um). */
export type SuggestedPerson = PublicProfile & PeopleSignals & { reason: PeopleReason };

export interface ConnectionsPage {
  items: PublicProfile[];
  /** Total de conexões aceitas; pode incluir pessoas ocultas para o visitante por bloqueio. */
  total: number;
  limit: number;
  offset: number;
}

const USER_NOT_FOUND = 'Usuário não encontrado';

export class FollowService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Perfil público -> ACCEPTED; perfil privado -> PENDING até aprovação. Idempotente. */
  async follow(actorId: string, targetId: string): Promise<FollowResult> {
    const { follows, blocks, clock } = this.deps;
    if (actorId === targetId) throw validationError('Você não pode seguir a si mesmo');

    const target = await this.requireVisibleTarget(actorId, targetId);
    if (await blocks.exists(actorId, targetId)) {
      throw conflict('Desbloqueie este usuário para segui-lo');
    }

    const existing = await follows.get(actorId, targetId);
    if (existing) {
      return { status: existing.status, isFriend: await this.areFriends(actorId, targetId) };
    }

    const status: FollowStatus = target.isPrivate ? 'PENDING' : 'ACCEPTED';
    await follows.save({ followerId: actorId, followeeId: targetId, status, createdAt: clock.now() });
    const name = await this.nameOf(actorId);
    if (status === 'PENDING') await this.deps.notifier.notify({ userId: targetId, type: 'FOLLOW_REQUEST', title: `${name} quer seguir você`, body: 'Toque para ver o pedido', url: '/atividades?aba=pedidos', dedupeKey: `follow-request:${actorId}`, actorId });
    else await this.deps.notifier.notify({ userId: targetId, type: 'FOLLOW_NEW', title: `${name} começou a seguir você`, body: 'Toque para ver o perfil', url: await this.profileUrl(actorId), dedupeKey: `follow-new:${actorId}`, actorId });
    return { status, isFriend: await this.areFriends(actorId, targetId) };
  }

  /** Cancela seguimento ou solicitação pendente. Encerra a amizade, se houver. Idempotente. */
  async unfollow(actorId: string, targetId: string): Promise<{ removed: boolean }> {
    const removed = await this.deps.follows.delete(actorId, targetId);
    return { removed };
  }

  /** O dono da conta aprova uma solicitação pendente. */
  async approve(actorId: string, followerId: string): Promise<{ isFriend: boolean }> {
    const { follows, blocks, clock } = this.deps;
    const request = await follows.get(followerId, actorId);
    if (!request || request.status !== 'PENDING') throw notFound('Solicitação não encontrada');

    if (await blocks.existsEitherWay(actorId, followerId)) {
      await follows.delete(followerId, actorId);
      throw notFound('Solicitação não encontrada');
    }

    await follows.save({ ...request, status: 'ACCEPTED', createdAt: request.createdAt ?? clock.now() });
    await this.deps.notifier.notify({ userId: followerId, type: 'FOLLOW_ACCEPTED', title: `${await this.nameOf(actorId)} aceitou seu pedido`, body: 'Agora você segue essa pessoa', url: await this.profileUrl(actorId), dedupeKey: `follow-accepted:${actorId}`, actorId });
    return { isFriend: await this.areFriends(actorId, followerId) };
  }

  private async nameOf(userId: string): Promise<string> {
    return (await this.deps.users.findProfilesByIds([userId]))[0]?.username ?? 'Alguém';
  }

  /** Caminho do perfil de quem agiu (o toque no aviso abre ali). Sem perfil visível, cai nas Notificações. */
  private async profileUrl(userId: string): Promise<string> {
    const username = (await this.deps.users.findProfilesByIds([userId]))[0]?.username;
    return username ? `/u/${encodeURIComponent(username)}` : '/atividades';
  }

  async reject(actorId: string, followerId: string): Promise<void> {
    const request = await this.deps.follows.get(followerId, actorId);
    if (!request || request.status !== 'PENDING') throw notFound('Solicitação não encontrada');
    await this.deps.follows.delete(followerId, actorId);
  }

  /** O dono da conta remove um seguidor já aceito. Encerra a amizade, se houver. */
  async removeFollower(actorId: string, followerId: string): Promise<void> {
    const row = await this.deps.follows.get(followerId, actorId);
    if (!row || row.status !== 'ACCEPTED') throw notFound('Seguidor não encontrado');
    await this.deps.follows.delete(followerId, actorId);
  }

  listFollowers(viewerId: string, targetId: string, page?: Partial<Page>): Promise<ConnectionsPage> {
    return this.listConnections(viewerId, targetId, 'followers', page);
  }

  listFollowing(viewerId: string, targetId: string, page?: Partial<Page>): Promise<ConnectionsPage> {
    return this.listConnections(viewerId, targetId, 'following', page);
  }

  /** Solicitações pendentes recebidas pelo próprio usuário. */
  async listPendingRequests(actorId: string, pageInput?: Partial<Page>): Promise<ConnectionsPage> {
    const { follows, users } = this.deps;
    const page = normalizePage(pageInput);
    const [rows, total] = await Promise.all([
      follows.list(actorId, 'followers', 'PENDING', page),
      follows.count(actorId, 'followers', 'PENDING'),
    ]);
    const profiles = await users.findProfilesByIds(rows.map((r) => r.followerId));
    return { items: profiles.map(toPublicProfile), total, ...page };
  }

  /** Amigos (seguimento mútuo, sem bloqueios), em ordem alfabética. Base para Flash e convites. */
  async listFriends(actorId: string): Promise<PublicProfile[]> {
    const ids = await this.deps.follows.listFriendIds(actorId);
    const profiles = await this.deps.users.findProfilesByIds(ids);
    return profiles
      .map(toPublicProfile)
      .sort((a, b) => a.username.localeCompare(b.username, 'pt-BR') || a.userId.localeCompare(b.userId));
  }

  /**
   * Amigos em comum entre o visitante e o dono do perfil: amigos dos dois (seguimento mútuo, sem bloqueio),
   * fora quem tem bloqueio com o visitante. No próprio perfil ou sem nenhum em comum, a lista vem vazia.
   * Mostra os amigos do próprio visitante, então vale até para perfil privado.
   */
  async mutualFriends(viewerId: string, targetId: string): Promise<{ items: PublicProfile[]; total: number }> {
    if (viewerId === targetId) return { items: [], total: 0 };
    await this.requireVisibleTarget(viewerId, targetId);
    const { follows, blocks, users } = this.deps;
    const [mine, theirs, related] = await Promise.all([follows.listFriendIds(viewerId), follows.listFriendIds(targetId), blocks.listRelatedIds(viewerId)]);
    const hidden = new Set([viewerId, targetId, ...related]);
    const theirSet = new Set(theirs);
    const ids = mine.filter((id) => theirSet.has(id) && !hidden.has(id));
    if (ids.length === 0) return { items: [], total: 0 };
    const profiles = await users.findProfilesByIds(ids);
    const items = profiles
      .map(toPublicProfile)
      .sort((a, b) => a.username.localeCompare(b.username, 'pt-BR') || a.userId.localeCompare(b.userId));
    return { items, total: items.length };
  }

  /** Quem a pessoa já segue ou pediu para seguir. */
  private async followedIds(actorId: string): Promise<Set<string>> {
    const out = new Set<string>();
    for (const status of ['ACCEPTED', 'PENDING'] as const) {
      for (let offset = 0; offset < 2000; offset += MAX_PAGE_LIMIT) {
        const rows = await this.deps.follows.list(actorId, 'following', status, { limit: MAX_PAGE_LIMIT, offset });
        for (const r of rows) out.add(r.followeeId);
        if (rows.length < MAX_PAGE_LIMIT) break;
      }
    }
    return out;
  }

  /**
   * Amigos nos contatos: o app manda só o SHA-256 (hex) do e-mail em minúsculas de cada contato; o servidor não recebe nem guarda e-mails em claro.
   * Devolve quem tem conta, menos você, quem você já segue e quem tem bloqueio com você.
   */
  async contactMatches(actorId: string, hashes: unknown, phoneHashes: unknown = []): Promise<{ items: PublicProfile[] }> {
    const clean = cleanHashes(hashes, 'hashes', CONTACT_HASHES_MAX);
    const phones = cleanHashes(phoneHashes ?? [], 'phoneHashes', CONTACT_PHONE_HASHES_MAX);
    const { users, blocks } = this.deps;
    const [byEmail, byPhone, related, followed] = await Promise.all([users.findIdsByEmailHashes(clean), users.findIdsByPhoneHashes(phones), blocks.listRelatedIds(actorId), this.followedIds(actorId)]);
    const ids = [...new Set([...byEmail, ...byPhone])];
    const hidden = new Set([actorId, ...related, ...followed]);
    const profiles = await users.findProfilesByIds(ids.filter((id) => !hidden.has(id)));
    return { items: profiles.map(toPublicProfile).sort((a, b) => a.username.localeCompare(b.username, 'pt-BR') || a.userId.localeCompare(b.userId)) };
  }

  /**
   * "Pessoas que você talvez conheça": várias fontes num placar só (ver people-suggestions.ts): amigos em comum, eventos
   * de local em que as duas pessoas confirmaram presença, quem já segue você e gostos de rolê em comum.
   * Fora: você, seus amigos, quem você já segue (ou pediu para seguir) e quem tem bloqueio com você.
   */
  async suggestedPeople(actorId: string): Promise<{ items: SuggestedPerson[]; followingCount: number }> {
    const { follows, blocks, users, eventRoom } = this.deps;
    const friends = await follows.listFriendIds(actorId);
    const [followingCount, related] = await Promise.all([follows.count(actorId, 'following', 'ACCEPTED'), blocks.listRelatedIds(actorId)]);
    const skip = new Set<string>([actorId, ...friends, ...related, ...(await this.followedIds(actorId))]);
    const signals = new Map<string, PeopleSignals>();
    const signalOf = (id: string): PeopleSignals => {
      let s = signals.get(id);
      if (!s) {
        s = { mutualCount: 0, sharedEvents: 0, followsYou: false, sharedTastes: 0 };
        signals.set(id, s);
      }
      return s;
    };

    // Amigos em comum
    for (const friendId of friends.slice(0, PEOPLE_MAX_FRIENDS)) {
      for (const candidate of await follows.listFriendIds(friendId)) {
        if (!skip.has(candidate)) signalOf(candidate).mutualCount += 1;
      }
    }
    // Quem já segue você e você ainda não segue
    for (const row of await follows.list(actorId, 'followers', 'ACCEPTED', { limit: Math.min(PEOPLE_MAX_FOLLOWERS, MAX_PAGE_LIMIT), offset: 0 })) {
      if (!skip.has(row.followerId)) signalOf(row.followerId).followsYou = true;
    }
    // Eventos de local em que as duas pessoas confirmaram presença (eventos de pessoas ficam de fora: podem ser privados)
    const going = (await eventRoom.listGoingByUser(actorId, PEOPLE_MAX_EVENTS)).filter((g) => g.ref.source === 'PLACE');
    for (const { ref } of going) {
      const attendees = (await eventRoom.listGoing(ref)).slice(0, PEOPLE_MAX_ATTENDEES_PER_EVENT);
      for (const { userId } of attendees) {
        if (!skip.has(userId)) signalOf(userId).sharedEvents += 1;
      }
    }
    // Gostos de rolê em comum: só somam para quem já é candidato
    const mine = new Set((await users.findById(actorId))?.tastes ?? []);
    if (mine.size > 0) {
      for (const [id, s] of signals) {
        const theirs = (await users.findById(id))?.tastes ?? [];
        s.sharedTastes = theirs.filter((t) => mine.has(t)).length;
      }
    }

    const ranked = [...signals.entries()]
      .map(([id, s]) => ({ id, s, ...scorePerson(s) }))
      .sort((a, b) => b.score - a.score || b.s.mutualCount - a.s.mutualCount || (a.id < b.id ? -1 : 1))
      .slice(0, PEOPLE_MAX_ITEMS);
    const profiles = await users.findProfilesByIds(ranked.map((r) => r.id));
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const items = ranked.flatMap((r): SuggestedPerson[] => {
      const p = byId.get(r.id);
      return p ? [{ ...toPublicProfile(p), mutualCount: r.s.mutualCount, sharedEvents: r.s.sharedEvents, followsYou: r.s.followsYou, sharedTastes: r.s.sharedTastes, reason: r.reason }] : [];
    });
    return { items, followingCount };
  }

  /**
   * Regra única de amizade no backend. Outros módulos (Flash, agenda, encontros)
   * devem chamar este método em vez de reimplementar a regra.
   */
  async areFriends(a: string, b: string): Promise<boolean> {
    if (a === b) return false;
    const { follows, blocks } = this.deps;
    const [ab, ba, blocked] = await Promise.all([follows.get(a, b), follows.get(b, a), blocks.existsEitherWay(a, b)]);
    return evaluateFriendship(ab, ba, blocked);
  }

  private async listConnections(
    viewerId: string,
    targetId: string,
    direction: Direction,
    pageInput?: Partial<Page>,
  ): Promise<ConnectionsPage> {
    const { follows, blocks, users } = this.deps;
    const target = await this.requireVisibleTarget(viewerId, targetId);

    if (viewerId !== targetId && target.isPrivate) {
      const viewerFollows = await follows.get(viewerId, targetId);
      if (viewerFollows?.status !== 'ACCEPTED') throw forbidden('Esta conta é privada');
    }

    const page = normalizePage(pageInput);
    const [rows, total, related] = await Promise.all([
      follows.list(targetId, direction, 'ACCEPTED', page),
      follows.count(targetId, direction, 'ACCEPTED'),
      blocks.listRelatedIds(viewerId),
    ]);
    const hidden = new Set(related);
    const ids = rows
      .map((r) => (direction === 'followers' ? r.followerId : r.followeeId))
      .filter((id) => !hidden.has(id));
    const profiles = await users.findProfilesByIds(ids);
    return { items: profiles.map(toPublicProfile), total, ...page };
  }

  /** Alvo existe, está ativo e não bloqueou o ator. Caso contrário, NOT_FOUND (sem revelar o motivo). */
  private async requireVisibleTarget(actorId: string, targetId: string): Promise<Profile> {
    const { users, blocks } = this.deps;
    const [user, profile] = await Promise.all([users.findById(targetId), users.findProfileById(targetId)]);
    if (!user || !profile || user.status === 'SUSPENDED') throw notFound(USER_NOT_FOUND);
    if (actorId !== targetId && (await blocks.exists(targetId, actorId))) throw notFound(USER_NOT_FOUND);
    return profile;
  }
}
