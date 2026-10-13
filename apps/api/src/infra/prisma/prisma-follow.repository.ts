import type { PrismaClient } from '@prisma/client';
import type { FollowRepository } from '../../core/ports.ts';
import type { Direction, Follow, FollowStatus, Page } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

function toFollow(row: { followerId: string; followeeId: string; status: FollowStatus; createdAt: Date }): Follow {
  return { followerId: row.followerId, followeeId: row.followeeId, status: row.status, createdAt: row.createdAt };
}

export class PrismaFollowRepository implements FollowRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async get(followerId: string, followeeId: string): Promise<Follow | undefined> {
    if (!isUuid(followerId) || !isUuid(followeeId)) return undefined;
    const row = await this.prisma.follow.findUnique({
      where: { followerId_followeeId: { followerId, followeeId } },
    });
    return row ? toFollow(row) : undefined;
  }

  async save(follow: Follow): Promise<void> {
    await this.prisma.follow.upsert({
      where: { followerId_followeeId: { followerId: follow.followerId, followeeId: follow.followeeId } },
      create: {
        followerId: follow.followerId,
        followeeId: follow.followeeId,
        status: follow.status,
        createdAt: follow.createdAt,
      },
      // createdAt fica de fora de propósito: preserva a data original.
      update: { status: follow.status },
    });
  }

  async delete(followerId: string, followeeId: string): Promise<boolean> {
    if (!isUuid(followerId) || !isUuid(followeeId)) return false;
    const result = await this.prisma.follow.deleteMany({ where: { followerId, followeeId } });
    return result.count > 0;
  }

  async deleteBetween(a: string, b: string): Promise<void> {
    if (!isUuid(a) || !isUuid(b)) return;
    await this.prisma.follow.deleteMany({
      where: {
        OR: [
          { followerId: a, followeeId: b },
          { followerId: b, followeeId: a },
        ],
      },
    });
  }

  async list(userId: string, direction: Direction, status: FollowStatus, page: Page): Promise<Follow[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.follow.findMany({
      where: direction === 'followers' ? { followeeId: userId, status } : { followerId: userId, status },
      orderBy: [{ createdAt: 'desc' }, { followerId: 'asc' }],
      skip: page.offset,
      take: page.limit,
    });
    return rows.map(toFollow);
  }

  async count(userId: string, direction: Direction, status: FollowStatus): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.follow.count({
      where: direction === 'followers' ? { followeeId: userId, status } : { followerId: userId, status },
    });
  }

  async acceptAllPending(followeeId: string): Promise<number> {
    if (!isUuid(followeeId)) return 0;
    const result = await this.prisma.follow.updateMany({
      where: { followeeId, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
    return result.count;
  }

  /**
   * Seguimento mútuo aceito, sem bloqueio em nenhum sentido (mesma regra da view SQL `friendships`
   * e de `evaluateFriendship`). Feito com consultas Prisma, sem SQL cru, para depender só do schema.
   */
  async listFriendIds(userId: string): Promise<string[]> {
    if (!isUuid(userId)) return [];
    const [following, followers, blocks] = await Promise.all([
      this.prisma.follow.findMany({ where: { followerId: userId, status: 'ACCEPTED' }, select: { followeeId: true } }),
      this.prisma.follow.findMany({ where: { followeeId: userId, status: 'ACCEPTED' }, select: { followerId: true } }),
      this.prisma.block.findMany({
        where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);

    const followedBy = new Set((followers as { followerId: string }[]).map((f) => f.followerId));
    const blocked = new Set<string>();
    for (const b of blocks as { blockerId: string; blockedId: string }[]) blocked.add(b.blockerId === userId ? b.blockedId : b.blockerId);

    return (following as { followeeId: string }[])
      .map((f) => f.followeeId)
      .filter((id) => followedBy.has(id) && !blocked.has(id));
  }
}
