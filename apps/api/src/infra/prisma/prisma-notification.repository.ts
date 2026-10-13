import type { PrismaClient } from '@prisma/client';
import type { NotificationRepository, PushSubscriptionRepository } from '../../core/ports.ts';
import type { NotificationRecord, NotificationType, PushSubscriptionRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

interface Payload {
  title: string;
  body: string;
  url: string;
  dedupeKey: string | null;
}

export class PrismaNotificationRepository implements NotificationRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(record: NotificationRecord): Promise<void> {
    const payload: Payload = { title: record.title, body: record.body, url: record.url, dedupeKey: record.dedupeKey };
    await this.prisma.notification.create({ data: { id: record.id, userId: record.userId, type: record.type, payload, readAt: record.readAt, createdAt: record.createdAt } });
  }

  async listForUser(userId: string, limit: number): Promise<NotificationRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit });
    return rows.map((r) => {
      const p = r.payload as unknown as Payload;
      return { id: r.id, userId: r.userId, type: r.type as NotificationType, title: p.title, body: p.body, url: p.url, dedupeKey: p.dedupeKey ?? null, readAt: r.readAt, createdAt: r.createdAt };
    });
  }

  async unreadCount(userId: string): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async hasUnread(userId: string, dedupeKey: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const count = await this.prisma.notification.count({ where: { userId, readAt: null, payload: { path: ['dedupeKey'], equals: dedupeKey } } });
    return count > 0;
  }

  async markRead(userId: string, now: Date, ids?: string[]): Promise<number> {
    if (!isUuid(userId)) return 0;
    const valid = ids?.filter(isUuid);
    if (ids && valid && valid.length === 0) return 0;
    const result = await this.prisma.notification.updateMany({ where: { userId, readAt: null, ...(valid ? { id: { in: valid } } : {}) }, data: { readAt: now } });
    return result.count;
  }
}

export class PrismaPushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async upsert(record: PushSubscriptionRecord): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: record.endpoint },
      create: { endpoint: record.endpoint, userId: record.userId, p256dh: record.p256dh, auth: record.auth, createdAt: record.createdAt },
      update: { userId: record.userId, p256dh: record.p256dh, auth: record.auth },
    });
  }

  async remove(endpoint: string, userId?: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, ...(userId ? { userId } : {}) } });
  }

  async listForUser(userId: string): Promise<PushSubscriptionRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.pushSubscription.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({ userId: r.userId, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, createdAt: r.createdAt }));
  }
}
