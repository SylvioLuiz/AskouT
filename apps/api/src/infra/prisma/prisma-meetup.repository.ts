import type { PrismaClient } from '@prisma/client';
import type { MeetupRepository } from '../../core/ports.ts';
import type { MeetupParticipantStatus, MeetupRecord } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

type Row = {
  id: string;
  organizerId: string;
  conversationId: string | null;
  eventId: string | null;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  createdAt: Date;
  participants: { userId: string; status: string; respondedAt: Date | null }[];
};

const toRecord = (r: Row): MeetupRecord | undefined =>
  r.conversationId && r.startsAt && r.endsAt
    ? {
        id: r.id,
        organizerId: r.organizerId,
        conversationId: r.conversationId,
        eventId: r.eventId,
        title: r.title,
        startsAt: r.startsAt,
        endsAt: r.endsAt,
        status: r.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
        createdAt: r.createdAt,
        participants: r.participants
          .map((p) => ({ userId: p.userId, status: (p.status === 'CONFIRMED' || p.status === 'DECLINED' ? p.status : 'INVITED') as MeetupParticipantStatus, respondedAt: p.respondedAt }))
          .sort((a, b) => (a.userId < b.userId ? -1 : 1)),
      }
    : undefined;

export class PrismaMeetupRepository implements MeetupRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(m: MeetupRecord): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: m.conversationId }, select: { groupId: true } });
    await this.prisma.meeting.create({
      data: {
        id: m.id,
        organizerId: m.organizerId,
        groupId: conversation?.groupId ?? null,
        conversationId: m.conversationId,
        eventId: m.eventId,
        title: m.title,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        status: m.status === 'CANCELLED' ? 'CANCELLED' : 'PLANNING',
        createdAt: m.createdAt,
        participants: { create: m.participants.map((p) => ({ userId: p.userId, status: p.status, respondedAt: p.respondedAt })) },
      },
    });
  }

  async find(id: string): Promise<MeetupRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.meeting.findUnique({ where: { id }, include: { participants: true } });
    return row ? toRecord(row) : undefined;
  }

  async listForConversation(conversationId: string): Promise<MeetupRecord[]> {
    if (!isUuid(conversationId)) return [];
    const rows = await this.prisma.meeting.findMany({ where: { conversationId }, include: { participants: true }, orderBy: [{ startsAt: 'asc' }, { id: 'asc' }] });
    return rows.map(toRecord).filter((m): m is MeetupRecord => m !== undefined);
  }

  async respond(meetupId: string, userId: string, status: 'CONFIRMED' | 'DECLINED', at: Date): Promise<boolean> {
    if (!isUuid(meetupId) || !isUuid(userId)) return false;
    const result = await this.prisma.meetingParticipant.updateMany({ where: { meetingId: meetupId, userId, status: 'INVITED' }, data: { status, respondedAt: at } });
    return result.count > 0;
  }

  async update(meetupId: string, patch: { title?: string; status?: 'ACTIVE' | 'CANCELLED' }): Promise<void> {
    if (!isUuid(meetupId)) return;
    await this.prisma.meeting.update({
      where: { id: meetupId },
      data: { ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.status !== undefined ? { status: patch.status === 'CANCELLED' ? 'CANCELLED' : 'PLANNING' } : {}) },
    });
  }

  async invite(meetupId: string, userIds: string[]): Promise<string[]> {
    if (!isUuid(meetupId)) return [];
    const done: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const userId of userIds) {
        const existing = await tx.meetingParticipant.findUnique({ where: { meetingId_userId: { meetingId: meetupId, userId } } });
        if (!existing) {
          await tx.meetingParticipant.create({ data: { meetingId: meetupId, userId, status: 'INVITED' } });
          done.push(userId);
        } else if (existing.status === 'DECLINED') {
          await tx.meetingParticipant.update({ where: { meetingId_userId: { meetingId: meetupId, userId } }, data: { status: 'INVITED', respondedAt: null } });
          done.push(userId);
        }
      }
    });
    return done;
  }

  async declineAllFor(conversationId: string, userId: string, at: Date): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    await this.prisma.meetingParticipant.updateMany({
      where: { userId, status: { in: ['CONFIRMED', 'INVITED'] }, meeting: { conversationId, organizerId: { not: userId } } },
      data: { status: 'DECLINED', respondedAt: at },
    });
  }

  async countCreatedSince(userId: string, since: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.meeting.count({ where: { organizerId: userId, createdAt: { gte: since } } });
  }
}
