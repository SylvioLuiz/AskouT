import type { Prisma, PrismaClient } from '@prisma/client';
import type { ConversationRepository } from '../../core/ports.ts';
import type { ConversationRecord, ConversationSummaryRecord, MessageRecord, SuggestionCard, SuggestionResponse } from '../../core/types.ts';
import { isUuid, uniqueViolationTargets } from './helpers.ts';

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: 'TEXT' | 'SUGGESTION';
  body: string;
  suggestion: unknown;
  response: 'ACCEPTED' | 'DECLINED' | null;
  respondedAt: Date | null;
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
  createdAt: r.createdAt,
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
      const row = await this.prisma.conversation.findUnique({ where: { directKey } });
      return row ? { id: row.id, directKey, createdAt: row.createdAt } : undefined;
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
      return { id, directKey, createdAt: now };
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
    const row = await this.prisma.conversation.findUnique({ where: { id } });
    if (!row || row.directKey === null) return undefined;
    return { id: row.id, directKey: row.directKey, createdAt: row.createdAt };
  }

  async participantIds(conversationId: string): Promise<[string, string] | undefined> {
    if (!isUuid(conversationId)) return undefined;
    const rows = await this.prisma.conversationParticipant.findMany({ where: { conversationId }, select: { userId: true }, orderBy: { userId: 'asc' } });
    const [x, y] = rows;
    return rows.length === 2 && x && y ? [x.userId, y.userId] : undefined;
  }

  async listForUser(userId: string): Promise<ConversationSummaryRecord[]> {
    if (!isUuid(userId)) return [];
    const mine = await this.prisma.conversationParticipant.findMany({
      where: { userId, conversation: { type: 'DIRECT' } },
      include: {
        conversation: { include: { participants: { select: { userId: true } }, messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } } },
      },
    });
    const out: ConversationSummaryRecord[] = [];
    for (const p of mine) {
      const c = p.conversation;
      const ids = c.participants.map((x: { userId: string }) => x.userId).sort();
      const [x, y] = ids;
      if (ids.length !== 2 || x === undefined || y === undefined || c.directKey === null) continue;
      const unread = await this.prisma.message.count({
        where: { conversationId: c.id, senderId: { not: userId }, ...(p.lastReadAt ? { createdAt: { gt: p.lastReadAt } } : {}) },
      });
      const last = c.messages[0];
      out.push({
        conversation: { id: c.id, directKey: c.directKey, createdAt: c.createdAt },
        participantIds: [x, y],
        lastMessage: last ? toMessage(last as MessageRow) : null,
        unread,
      });
    }
    const stamp = (s: ConversationSummaryRecord) => (s.lastMessage ?? s.conversation).createdAt.getTime();
    return out.sort((a, b) => stamp(b) - stamp(a));
  }

  async addMessage(m: MessageRecord): Promise<void> {
    await this.prisma.message.create({
      data: {
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        kind: m.kind,
        body: m.body,
        // Mensagem de texto não leva o campo (a restrição do banco exige NULL fora de SUGGESTION).
        ...(m.suggestion ? { suggestion: m.suggestion as unknown as Prisma.InputJsonValue } : {}),
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

  async listMessages(conversationId: string, limit: number, before?: Date): Promise<MessageRecord[]> {
    if (!isUuid(conversationId)) return [];
    const rows = await this.prisma.message.findMany({
      where: { conversationId, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return (rows as MessageRow[]).reverse().map(toMessage);
  }

  async markRead(conversationId: string, userId: string, now: Date): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    await this.prisma.conversationParticipant.updateMany({ where: { conversationId, userId }, data: { lastReadAt: now } });
  }

  async countSentSince(userId: string, since: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.message.count({ where: { senderId: userId, createdAt: { gte: since } } });
  }
}
