import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ConversationRepository } from '../../core/ports.ts';
import type { ConversationRecord, ConversationReportRecord, ConversationSummaryRecord, MessageRecord, SuggestionCard, SuggestionResponse } from '../../core/types.ts';
import { isUuid, uniqueViolationTargets } from './helpers.ts';

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: 'TEXT' | 'SUGGESTION' | 'MEETUP' | 'SYSTEM' | 'EVENT' | 'AUDIO';
  body: string;
  suggestion: unknown;
  response: 'ACCEPTED' | 'DECLINED' | null;
  respondedAt: Date | null;
  meetupId: string | null;
  eventId: string | null;
  postEventId: string | null;
  audioMs: number | null;
  createdAt: Date;
};

const toMessage = (r: MessageRow): MessageRecord => ({
  id: r.id,
  conversationId: r.conversationId,
  senderId: r.senderId,
  kind: r.kind,
  body: r.body,
  suggestion: r.suggestion === null || r.suggestion === undefined ? null : (r.suggestion as SuggestionCard),
  response: r.response,
  respondedAt: r.respondedAt,
  meetupId: r.meetupId,
  eventId: r.eventId,
  postEventId: r.postEventId,
  audioMs: r.audioMs,
  createdAt: r.createdAt,
});

type ConversationRow = { id: string; type: 'DIRECT' | 'GROUP'; directKey: string | null; createdAt: Date; group: { name: string; ownerId: string; imageUrl: string | null } | null };

const toConversation = (c: ConversationRow): ConversationRecord => ({
  id: c.id,
  type: c.type,
  directKey: c.directKey,
  name: c.group?.name ?? null,
  ownerId: c.group?.ownerId ?? null,
  imageUrl: c.group?.imageUrl ?? null,
  createdAt: c.createdAt,
});

const directKeyOf = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export class PrismaConversationRepository implements ConversationRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async getOrCreateDirect(a: string, b: string, id: string, now: Date): Promise<ConversationRecord> {
    const directKey = directKeyOf(a, b);
    const find = async () => {
      const row = await this.prisma.conversation.findUnique({ where: { directKey }, include: { group: true } });
      return row ? toConversation(row) : undefined;
    };
    const existing = await find();
    if (existing) return existing;
    try {
      await this.prisma.conversation.create({
        data: {
          id,
          type: 'DIRECT',
          directKey,
          createdAt: now,
          participants: { create: [{ userId: a }, { userId: b }] },
        },
      });
      return { id, type: 'DIRECT', directKey, name: null, ownerId: null, imageUrl: null, createdAt: now };
    } catch (error) {
      // Duas requisições criaram ao mesmo tempo: a segunda usa a conversa da primeira.
      if (uniqueViolationTargets(error) !== undefined) {
        const winner = await find();
        if (winner) return winner;
      }
      throw error;
    }
  }

  async findById(id: string): Promise<ConversationRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.conversation.findUnique({ where: { id }, include: { group: true } });
    return row ? toConversation(row) : undefined;
  }

  async participantIds(conversationId: string): Promise<string[] | undefined> {
    if (!isUuid(conversationId)) return undefined;
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } });
    if (!conversation) return undefined;
    if (conversation.groupId) {
      // Grupo: quem entrou primeiro vem primeiro (o dono passa para o mais antigo quando o dono sai).
      const members = await this.prisma.groupMember.findMany({ where: { groupId: conversation.groupId }, select: { userId: true }, orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }] });
      return members.map((m) => m.userId);
    }
    const rows = await this.prisma.conversationParticipant.findMany({ where: { conversationId }, select: { userId: true }, orderBy: { userId: 'asc' } });
    return rows.length > 0 ? rows.map((r) => r.userId) : undefined;
  }

  async createGroup(input: { id: string; name: string; ownerId: string; now: Date }): Promise<ConversationRecord> {
    const groupId = randomUUID();
    await this.prisma.group.create({
      data: {
        id: groupId,
        ownerId: input.ownerId,
        name: input.name,
        createdAt: input.now,
        members: { create: [{ userId: input.ownerId, role: 'OWNER', joinedAt: input.now }] },
        conversation: { create: { id: input.id, type: 'GROUP', createdAt: input.now, participants: { create: [{ userId: input.ownerId }] } } },
      },
    });
    return { id: input.id, type: 'GROUP', directKey: null, name: input.name, ownerId: input.ownerId, imageUrl: null, createdAt: input.now };
  }

  async removeParticipant(conversationId: string, userId: string): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.conversationParticipant.deleteMany({ where: { conversationId, userId } });
      if (conversation?.groupId) await tx.groupMember.deleteMany({ where: { groupId: conversation.groupId, userId } });
    });
  }

  async updateGroup(conversationId: string, patch: { name?: string; imageUrl?: string | null; ownerId?: string }): Promise<void> {
    if (!isUuid(conversationId)) return;
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } });
    if (!conversation?.groupId) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.group.update({
        where: { id: conversation.groupId as string },
        data: { ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.imageUrl !== undefined ? { imageUrl: patch.imageUrl } : {}), ...(patch.ownerId !== undefined ? { ownerId: patch.ownerId } : {}) },
      });
      if (patch.ownerId !== undefined) {
        await tx.groupMember.updateMany({ where: { groupId: conversation.groupId as string, role: 'OWNER' }, data: { role: 'MEMBER' } });
        await tx.groupMember.updateMany({ where: { groupId: conversation.groupId as string, userId: patch.ownerId }, data: { role: 'OWNER' } });
      }
    });
  }

  async addParticipant(conversationId: string, userId: string, now: Date): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.conversationParticipant.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { conversationId, userId }, update: {} });
      if (conversation?.groupId) {
        await tx.groupMember.upsert({ where: { groupId_userId: { groupId: conversation.groupId, userId } }, create: { groupId: conversation.groupId, userId, joinedAt: now }, update: {} });
      }
    });
  }

  async listForUser(userId: string, hiddenSenderIds: readonly string[] = []): Promise<ConversationSummaryRecord[]> {
    if (!isUuid(userId)) return [];
    const mine = await this.prisma.conversationParticipant.findMany({
      where: { userId },
      include: {
        conversation: { include: { group: true, participants: { select: { userId: true } } } },
      },
    });
    const out: ConversationSummaryRecord[] = [];
    for (const p of mine) {
      const c = p.conversation;
      const ids = c.participants.map((x: { userId: string }) => x.userId).sort();
      if (c.type === 'DIRECT' && ids.length !== 2) continue;
      const visible = { ...(hiddenSenderIds.length > 0 ? { senderId: { notIn: [...hiddenSenderIds] } } : {}), ...(p.clearedAt ? { createdAt: { gt: p.clearedAt } } : {}) };
      const lastReadFloor = [p.lastReadAt, p.clearedAt].filter((d): d is Date => d !== null).sort((x, y) => y.getTime() - x.getTime())[0];
      const unread = await this.prisma.message.count({
        where: { conversationId: c.id, senderId: { notIn: [userId, ...hiddenSenderIds] }, ...(lastReadFloor ? { createdAt: { gt: lastReadFloor } } : {}) },
      });
      const last = await this.prisma.message.findFirst({ where: { conversationId: c.id, ...visible }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      out.push({
        conversation: toConversation(c),
        participantIds: ids,
        lastMessage: last ? toMessage(last as MessageRow) : null,
        unread,
      });
    }
    const stamp = (s: ConversationSummaryRecord) => (s.lastMessage ?? s.conversation).createdAt.getTime();
    return out.sort((a, b) => stamp(b) - stamp(a));
  }

  async findAudio(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(messageId)) return undefined;
    const row = await this.prisma.messageAudio.findUnique({ where: { messageId } });
    return row ? { mime: row.mime, data: new Uint8Array(row.data) } : undefined;
  }

  async addMessage(m: MessageRecord, audio?: { mime: string; data: Uint8Array }): Promise<void> {
    await this.prisma.message.create({
      data: {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        kind: m.kind,
        body: m.body,
        // Mensagem de texto não leva o campo (a restrição do banco exige NULL fora de SUGGESTION).
        ...(m.suggestion ? { suggestion: m.suggestion as unknown as Prisma.InputJsonValue } : {}),
        ...(m.meetupId ? { meetupId: m.meetupId } : {}),
        ...(m.eventId ? { eventId: m.eventId } : {}),
        ...(m.postEventId ? { postEventId: m.postEventId } : {}),
        ...(m.audioMs ? { audioMs: m.audioMs } : {}),
        ...(audio ? { audio: { create: { mime: audio.mime, data: Buffer.from(audio.data) } } } : {}),
        createdAt: m.createdAt,
      },
    });
  }

  async findMessage(id: string): Promise<MessageRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.message.findUnique({ where: { id } });
    return row ? toMessage(row as MessageRow) : undefined;
  }

  async setSuggestionResponse(messageId: string, response: SuggestionResponse, at: Date): Promise<boolean> {
    if (!isUuid(messageId)) return false;
    // Só grava se ainda não houver resposta: duas respostas ao mesmo tempo não se sobrescrevem.
    const result = await this.prisma.message.updateMany({ where: { id: messageId, kind: 'SUGGESTION', response: null }, data: { response, respondedAt: at } });
    return result.count > 0;
  }

  async listMessages(conversationId: string, limit: number, before?: Date, excludeSenderIds: readonly string[] = [], after?: Date): Promise<MessageRecord[]> {
    if (!isUuid(conversationId)) return [];
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...(before || after ? { createdAt: { ...(before ? { lt: before } : {}), ...(after ? { gt: after } : {}) } } : {}), ...(excludeSenderIds.length > 0 ? { senderId: { notIn: [...excludeSenderIds] } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return (rows as MessageRow[]).reverse().map(toMessage);
  }

  async setCleared(conversationId: string, userId: string, at: Date): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    await this.prisma.conversationParticipant.updateMany({ where: { conversationId, userId }, data: { clearedAt: at } });
  }

  async getCleared(conversationId: string, userId: string): Promise<Date | null> {
    if (!isUuid(conversationId) || !isUuid(userId)) return null;
    const row = await this.prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { clearedAt: true } });
    return row?.clearedAt ?? null;
  }

  async addReport(report: ConversationReportRecord): Promise<void> {
    await this.prisma.conversationReport.upsert({
      where: { conversationId_reporterId: { conversationId: report.conversationId, reporterId: report.reporterId } },
      create: { id: report.id, conversationId: report.conversationId, reporterId: report.reporterId, reportedUserId: report.reportedUserId, reason: report.reason, details: report.details, evidence: report.evidence, createdAt: report.createdAt },
      update: { reason: report.reason, details: report.details, evidence: report.evidence, resolvedAt: null, resolvedBy: null, resolution: null, resolutionNote: null },
    });
  }

  async listShared(conversationId: string, limit: number, excludeSenderIds: readonly string[] = [], after?: Date): Promise<MessageRecord[]> {
    if (!isUuid(conversationId)) return [];
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(after ? { createdAt: { gt: after } } : {}),
        OR: [{ kind: 'AUDIO' }, { kind: 'TEXT', body: { contains: 'http', mode: 'insensitive' } }],
        ...(excludeSenderIds.length > 0 ? { senderId: { notIn: [...excludeSenderIds] } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return (rows as MessageRow[]).map(toMessage);
  }

  async markRead(conversationId: string, userId: string, now: Date): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    await this.prisma.conversationParticipant.updateMany({ where: { conversationId, userId }, data: { lastReadAt: now } });
  }

  async countSentSince(userId: string, since: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.message.count({ where: { senderId: userId, createdAt: { gte: since } } });
  }

  async hasPostEventAccess(userId: string, postId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(postId)) return false;
    const rows = await this.prisma.message.findMany({ where: { postEventId: postId }, select: { conversationId: true }, distinct: ['conversationId'], take: 50 });
    for (const row of rows) {
      if ((await this.participantIds(row.conversationId))?.includes(userId)) return true;
    }
    return false;
  }
}
