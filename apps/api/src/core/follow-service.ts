import { conflict, forbidden, notFound, validationError } from './errors.ts';
import { evaluateFriendship } from './friendship.ts';
import type { CoreDeps } from './ports.ts';
import type { Direction, FollowStatus, Page, Profile, PublicProfile } from './types.ts';
import { normalizePage, toPublicProfile } from './types.ts';

export interface FollowResult {
  status: FollowStatus;
  isFriend: boolean;
}

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
    if (status === 'PENDING') await this.deps.notifier.notify({ userId: targetId, type: 'FOLLOW_REQUEST', title: `${await this.nameOf(actorId)} quer seguir você`, body: 'Toque para ver o pedido', url: '/atividades', dedupeKey: `follow-request:${actorId}` });
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
    await this.deps.notifier.notify({ userId: followerId, type: 'FOLLOW_ACCEPTED', title: `${await this.nameOf(actorId)} aceitou seu pedido`, body: 'Agora você segue essa pessoa', url: '/', dedupeKey: `follow-accepted:${actorId}` });
    return { isFriend: await this.areFriends(actorId, followerId) };
  }

  private async nameOf(userId: string): Promise<string> {
    return (await this.deps.users.findProfilesByIds([userId]))[0]?.displayName ?? 'Alguém';
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
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'pt-BR') || a.userId.localeCompare(b.userId));
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
