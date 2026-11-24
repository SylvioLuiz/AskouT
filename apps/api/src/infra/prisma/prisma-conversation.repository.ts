import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { ConversationRepository } from '../../core/ports.ts';
import type { DirectActivityRow, GroupInviteRecord, ConversationPrefsRecord, ConversationRecord, ConversationReportRecord, ConversationSummaryRecord, MessageReactionRecord, MessageRecord, SuggestionCard, SuggestionResponse } from '../../core/types.ts';
import { DELETED_BODY } from '../../core/types.ts';
import { isUuid, uniqueViolationTargets } from './helpers.ts';

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: 'TEXT' | 'SUGGESTION' | 'MEETUP' | 'SYSTEM' | 'EVENT' | 'AUDIO' | 'IMAGE' | 'VIDEO' | 'FILE';
  body: string;
  suggestion: unknown;
  response: 'ACCEPTED' | 'DECLINED' | 'CANCELED' | null;
  respondedAt: Date | null;
  meetupId: string | null;
  eventId: string | null;
  postEventId: string | null;
  audioMs: number | null;
  gifId: string | null;
  gifUrl: string | null;
  storyId: string | null;
  replyToId: string | null;
  deletedAt: Date | null;
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
  gifId: r.gifId,
  gifUrl: r.gifUrl,
  storyId: r.storyId,
  replyToId: r.replyToId,
  deletedAt: r.deletedAt,
  createdAt: r.createdAt,
});

type ConversationRow = { id: string; type: 'DIRECT' | 'GROUP'; directKey: string | null; createdAt: Date; requestToId?: string | null; requestDeclinedAt?: Date | null; acceptedAt?: Date | null; venueId?: string | null; group: { name: string; ownerId: string; imageUrl: string | null; eventPostId: string | null; community?: boolean } | null };

const toConversation = (c: ConversationRow): ConversationRecord => ({
  id: c.id,
  type: c.type,
  directKey: c.directKey,
  name: c.group?.name ?? null,
  ownerId: c.group?.ownerId ?? null,
  imageUrl: c.group?.imageUrl ?? null,
  eventPostId: c.group?.eventPostId ?? null,
  community: c.group?.community === true,
  ...(c.type === 'DIRECT' ? { requestToId: c.requestToId ?? null, requestDeclinedAt: c.requestDeclinedAt ?? null, acceptedAt: c.acceptedAt ?? null, venueId: c.venueId ?? null } : {}),
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
      return { id, type: 'DIRECT', directKey, name: null, ownerId: null, imageUrl: null, eventPostId: null, requestToId: null, requestDeclinedAt: null, acceptedAt: null, venueId: null, createdAt: now };
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

  async getOrCreateVenueDirect(venueId: string, customerId: string, ownerId: string, id: string, now: Date): Promise<ConversationRecord> {
    const directKey = `venue:${venueId}:${customerId}`;
    const find = async () => {
      const row = await this.prisma.conversation.findUnique({ where: { directKey }, include: { group: true, participants: { select: { userId: true } } } });
      return row;
    };
    let row = await find();
    if (!row) {
      try {
        await this.prisma.conversation.create({ data: { id, type: 'DIRECT', directKey, venueId, createdAt: now, participants: { create: [{ userId: customerId }, { userId: ownerId }] } } });
      } catch (error) {
        if (uniqueViolationTargets(error) === undefined) throw error;
      }
      row = await find();
      if (!row) throw new Error('conversa do local não encontrada');
    }
    // O local trocou de dono: a outra ponta passa a ser o dono atual.
    const stale = row.participants.map((p: { userId: string }) => p.userId).filter((u: string) => u !== customerId && u !== ownerId);
    if (stale.length > 0 || !row.participants.some((p: { userId: string }) => p.userId === ownerId)) {
      await this.prisma.$transaction([
        this.prisma.conversationParticipant.deleteMany({ where: { conversationId: row.id, userId: { in: stale } } }),
        this.prisma.conversationParticipant.upsert({ where: { conversationId_userId: { conversationId: row.id, userId: ownerId } }, create: { conversationId: row.id, userId: ownerId }, update: {} }),
      ]);
    }
    return toConversation(row);
  }

  async findDirect(a: string, b: string): Promise<ConversationRecord | undefined> {
    if (!isUuid(a) || !isUuid(b)) return undefined;
    const row = await this.prisma.conversation.findUnique({ where: { directKey: directKeyOf(a, b) }, include: { group: true } });
    return row ? toConversation(row) : undefined;
  }

  async setRequest(conversationId: string, patch: { requestToId?: string | null; requestDeclinedAt?: Date | null; acceptedAt?: Date | null }): Promise<void> {
    if (!isUuid(conversationId)) return;
    await this.prisma.conversation.updateMany({ where: { id: conversationId, type: 'DIRECT' }, data: patch });
  }

  async getOpenDms(userId: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const row = await this.prisma.userSettings.findUnique({ where: { userId }, select: { openDms: true } });
    return row?.openDms === true;
  }

  async setOpenDms(userId: string, on: boolean): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.userSettings.upsert({ where: { userId }, create: { userId, openDms: on }, update: { openDms: on } });
  }

  async getShowOnline(userId: string): Promise<boolean> {
    if (!isUuid(userId)) return true;
    const row = await this.prisma.userSettings.findUnique({ where: { userId }, select: { showOnline: true } });
    return row?.showOnline !== false;
  }

  async setShowOnline(userId: string, on: boolean): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.userSettings.upsert({ where: { userId }, create: { userId, showOnline: on }, update: { showOnline: on } });
  }

  async listHiddenOnline(userIds: readonly string[]): Promise<string[]> {
    const ids = userIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = await this.prisma.userSettings.findMany({ where: { userId: { in: ids }, showOnline: false }, select: { userId: true } });
    return rows.map((r) => r.userId);
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

  async createGroup(input: { id: string; name: string; ownerId: string; now: Date; eventPostId?: string; community?: boolean }): Promise<ConversationRecord> {
    const groupId = randomUUID();
    await this.prisma.group.create({
      data: {
        id: groupId,
        ownerId: input.ownerId,
        name: input.name,
        ...(input.eventPostId ? { eventPostId: input.eventPostId } : {}),
        community: input.community === true,
        createdAt: input.now,
        members: { create: [{ userId: input.ownerId, role: 'OWNER', joinedAt: input.now }] },
        conversation: { create: { id: input.id, type: 'GROUP', createdAt: input.now, participants: { create: [{ userId: input.ownerId }] } } },
      },
    });
    return { id: input.id, type: 'GROUP', directKey: null, name: input.name, ownerId: input.ownerId, imageUrl: null, eventPostId: input.eventPostId ?? null, community: input.community === true, createdAt: input.now };
  }

  private async groupIdOf(conversationId: string): Promise<string | null> {
    if (!isUuid(conversationId)) return null;
    return (await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } }))?.groupId ?? null;
  }

  async addGroupInvite(conversationId: string, userId: string, invitedById: string, now: Date, shareHistory: boolean): Promise<boolean> {
    const groupId = await this.groupIdOf(conversationId);
    if (!groupId || !isUuid(userId)) return false;
    const created = await this.prisma.groupInvite.createMany({ data: [{ groupId, userId, invitedById: isUuid(invitedById) ? invitedById : null, shareHistory, createdAt: now }], skipDuplicates: true });
    return created.count > 0;
  }

  async removeGroupInvite(conversationId: string, userId: string): Promise<boolean> {
    const groupId = await this.groupIdOf(conversationId);
    if (!groupId || !isUuid(userId)) return false;
    return (await this.prisma.groupInvite.deleteMany({ where: { groupId, userId } })).count > 0;
  }

  async listGroupInvites(conversationId: string): Promise<GroupInviteRecord[]> {
    const groupId = await this.groupIdOf(conversationId);
    if (!groupId) return [];
    const rows = await this.prisma.groupInvite.findMany({ where: { groupId }, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }], take: 500 });
    return rows.map((r) => ({ conversationId, userId: r.userId, invitedById: r.invitedById, shareHistory: r.shareHistory, createdAt: r.createdAt }));
  }

  async listGroupInvitesForUser(userId: string): Promise<GroupInviteRecord[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.groupInvite.findMany({ where: { userId }, include: { group: { select: { conversation: { select: { id: true } } } } }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.flatMap((r) => (r.group.conversation ? [{ conversationId: r.group.conversation.id, userId: r.userId, invitedById: r.invitedById, shareHistory: r.shareHistory, createdAt: r.createdAt }] : []));
  }

  async groupIdsForEventPost(postId: string): Promise<string[]> {
    if (!isUuid(postId)) return [];
    const rows = await this.prisma.conversation.findMany({ where: { group: { eventPostId: postId } }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => r.id);
  }

  async removeParticipant(conversationId: string, userId: string): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.conversationParticipant.deleteMany({ where: { conversationId, userId } });
      if (conversation?.groupId) await tx.groupMember.deleteMany({ where: { groupId: conversation.groupId, userId } });
    });
  }

  async deleteGroup(conversationId: string): Promise<void> {
    if (!isUuid(conversationId)) return;
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true, type: true } });
    if (!conversation?.groupId || conversation.type !== 'GROUP') return;
    // Apagar o grupo leva junto a conversa, as mensagens e os membros (cascata); os encontros marcados ficam, sem o grupo.
    await this.prisma.group.delete({ where: { id: conversation.groupId } });
  }

  async adminIds(conversationId: string): Promise<string[]> {
    if (!isUuid(conversationId)) return [];
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } });
    if (!conversation?.groupId) return [];
    const rows = await this.prisma.groupMember.findMany({ where: { groupId: conversation.groupId, role: 'ADMIN' }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async setAdmin(conversationId: string, userId: string, admin: boolean): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { groupId: true } });
    if (!conversation?.groupId) return;
    // O dono nunca vira administrador nem volta a membro por aqui.
    await this.prisma.groupMember.updateMany({ where: { groupId: conversation.groupId, userId, role: { in: admin ? ['MEMBER'] : ['ADMIN'] } }, data: { role: admin ? 'ADMIN' : 'MEMBER' } });
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
    // Por conversa há dois acessos ao banco (não lidas e última mensagem). Em paralelo: antes eram em fila,
    // e com o banco longe do celular (Oregon) cada ida e volta somava na abertura da lista.
    const built = await Promise.all(
      mine.map(async (p): Promise<ConversationSummaryRecord | undefined> => {
        const c = p.conversation;
        const ids = c.participants.map((x: { userId: string }) => x.userId).sort();
        if (c.type === 'DIRECT' && ids.length !== 2) return undefined;
        const visible = { ...(hiddenSenderIds.length > 0 ? { senderId: { notIn: [...hiddenSenderIds] } } : {}), ...(p.clearedAt ? { createdAt: { gt: p.clearedAt } } : {}) };
        const lastReadFloor = [p.lastReadAt, p.clearedAt].filter((d): d is Date => d !== null).sort((x, y) => y.getTime() - x.getTime())[0];
        const [unread, last] = await Promise.all([
          this.prisma.message.count({
            where: { conversationId: c.id, senderId: { notIn: [userId, ...hiddenSenderIds] }, ...(lastReadFloor ? { createdAt: { gt: lastReadFloor } } : {}) },
          }),
          this.prisma.message.findFirst({ where: { conversationId: c.id, ...visible }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
        ]);
        return {
          conversation: toConversation(c),
          participantIds: ids,
          lastMessage: last ? toMessage(last as MessageRow) : null,
          unread,
          pinnedAt: p.pinnedAt,
          muted: p.muted,
          clearedAt: p.clearedAt,
        };
      }),
    );
    const out = built.filter((x): x is ConversationSummaryRecord => x !== undefined);
    const stamp = (s: ConversationSummaryRecord) => (s.lastMessage ?? s.conversation).createdAt.getTime();
    return out.sort((a, b) => stamp(b) - stamp(a));
  }

  async findAudio(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(messageId)) return undefined;
    const row = await this.prisma.messageAudio.findUnique({ where: { messageId } });
    return row ? { mime: row.mime, data: new Uint8Array(row.data) } : undefined;
  }

  async addMessage(m: MessageRecord, attachment?: { mime: string; data: Uint8Array }): Promise<void> {
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
        ...(m.gifId && m.gifUrl ? { gifId: m.gifId, gifUrl: m.gifUrl } : {}),
        ...(m.storyId ? { storyId: m.storyId } : {}),
        ...(m.replyToId ? { replyToId: m.replyToId } : {}),
        ...(attachment && m.kind === 'AUDIO' ? { audio: { create: { mime: attachment.mime, data: Buffer.from(attachment.data) } } } : {}),
        ...(attachment && m.kind !== 'AUDIO' ? { media: { create: { mime: attachment.mime, data: Buffer.from(attachment.data) } } } : {}),
        createdAt: m.createdAt,
      },
    });
  }

  async findMedia(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (!isUuid(messageId)) return undefined;
    const row = await this.prisma.messageMedia.findUnique({ where: { messageId } });
    return row ? { mime: row.mime, data: new Uint8Array(row.data) } : undefined;
  }

  async softDeleteMessage(messageId: string, at: Date): Promise<boolean> {
    if (!isUuid(messageId)) return false;
    return this.prisma.$transaction(async (tx) => {
      // Só apaga uma vez; o texto e os bytes vão embora junto.
      const result = await tx.message.updateMany({ where: { id: messageId, deletedAt: null }, data: { deletedAt: at, body: DELETED_BODY } });
      if (result.count === 0) return false;
      await tx.messageAudio.deleteMany({ where: { messageId } });
      await tx.messageMedia.deleteMany({ where: { messageId } });
      await tx.messageReaction.deleteMany({ where: { messageId } });
      return true;
    });
  }

  async markAudioPlayed(messageId: string, userId: string, at: Date): Promise<void> {
    if (!isUuid(messageId) || !isUuid(userId)) return;
    await this.prisma.messageAudioPlay.createMany({ data: [{ messageId, userId, playedAt: at }], skipDuplicates: true });
  }

  async listAudioPlays(messageIds: readonly string[]): Promise<{ messageId: string; userId: string }[]> {
    const valid = messageIds.filter(isUuid);
    if (valid.length === 0) return [];
    return this.prisma.messageAudioPlay.findMany({ where: { messageId: { in: valid } }, select: { messageId: true, userId: true } });
  }

  async setReaction(messageId: string, userId: string, emoji: string | null, at: Date): Promise<void> {
    if (!isUuid(messageId) || !isUuid(userId)) return;
    if (emoji === null) {
      await this.prisma.messageReaction.deleteMany({ where: { messageId, userId } });
      return;
    }
    await this.prisma.messageReaction.upsert({ where: { messageId_userId: { messageId, userId } }, create: { messageId, userId, emoji, createdAt: at }, update: { emoji, createdAt: at } });
  }

  async listReactions(messageIds: readonly string[]): Promise<MessageReactionRecord[]> {
    const valid = messageIds.filter(isUuid);
    if (valid.length === 0) return [];
    const rows = await this.prisma.messageReaction.findMany({ where: { messageId: { in: valid } }, orderBy: [{ userId: 'asc' }] });
    return rows.map((r) => ({ messageId: r.messageId, userId: r.userId, emoji: r.emoji }));
  }

  async setPrefs(conversationId: string, userId: string, patch: { pinnedAt?: Date | null; muted?: boolean; color?: string | null }): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId },
      data: { ...(patch.pinnedAt !== undefined ? { pinnedAt: patch.pinnedAt } : {}), ...(patch.muted !== undefined ? { muted: patch.muted } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) },
    });
  }

  async getPrefs(conversationId: string, userId: string): Promise<ConversationPrefsRecord> {
    if (!isUuid(conversationId) || !isUuid(userId)) return { pinnedAt: null, muted: false, color: null };
    const row = await this.prisma.conversationParticipant.findUnique({ where: { conversationId_userId: { conversationId, userId } }, select: { pinnedAt: true, muted: true, color: true } });
    return { pinnedAt: row?.pinnedAt ?? null, muted: row?.muted ?? false, color: row?.color ?? null };
  }

  async countPinned(userId: string): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.conversationParticipant.count({ where: { userId, pinnedAt: { not: null } } });
  }

  async mutedUserIds(conversationId: string): Promise<string[]> {
    if (!isUuid(conversationId)) return [];
    const rows = await this.prisma.conversationParticipant.findMany({ where: { conversationId, muted: true }, select: { userId: true } });
    return rows.map((r) => r.userId);
  }

  async findMessage(id: string): Promise<MessageRecord | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.message.findUnique({ where: { id } });
    return row ? toMessage(row as MessageRow) : undefined;
  }

  async withdrawSuggestion(messageId: string, at: Date): Promise<boolean> {
    if (!isUuid(messageId)) return false;
    const result = await this.prisma.message.updateMany({ where: { id: messageId, kind: 'SUGGESTION', OR: [{ response: null }, { response: 'ACCEPTED' }] }, data: { response: 'CANCELED', respondedAt: at } });
    return result.count > 0;
  }

  async clearSuggestionResponse(messageId: string, expected: SuggestionResponse): Promise<boolean> {
    if (!isUuid(messageId)) return false;
    const result = await this.prisma.message.updateMany({ where: { id: messageId, kind: 'SUGGESTION', response: expected }, data: { response: null, respondedAt: null } });
    return result.count > 0;
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
        deletedAt: null,
        OR: [{ kind: { in: ['AUDIO', 'IMAGE', 'VIDEO'] } }, { kind: 'TEXT', body: { contains: 'http', mode: 'insensitive' } }],
        ...(excludeSenderIds.length > 0 ? { senderId: { notIn: [...excludeSenderIds] } } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return (rows as MessageRow[]).map(toMessage);
  }

  async listReads(conversationId: string): Promise<{ userId: string; lastReadAt: Date | null }[]> {
    if (!isUuid(conversationId)) return [];
    return this.prisma.conversationParticipant.findMany({ where: { conversationId }, select: { userId: true, lastReadAt: true } });
  }

  async markRead(conversationId: string, userId: string, now: Date): Promise<void> {
    if (!isUuid(conversationId) || !isUuid(userId)) return;
    await this.prisma.conversationParticipant.updateMany({ where: { conversationId, userId }, data: { lastReadAt: now } });
  }

  async directActivity(userId: string, since: Date, limit: number): Promise<DirectActivityRow[]> {
    if (!isUuid(userId)) return [];
    const conversations = await this.prisma.conversation.findMany({
      where: { type: 'DIRECT', participants: { some: { userId } } },
      select: { id: true, participants: { select: { userId: true } } },
    });
    const otherOf = new Map<string, string>();
    for (const c of conversations) {
      const other = c.participants.find((p) => p.userId !== userId);
      if (other) otherOf.set(c.id, other.userId);
    }
    if (otherOf.size === 0) return [];
    const messages = await this.prisma.message.findMany({
      where: { conversationId: { in: [...otherOf.keys()] }, createdAt: { gte: since }, deletedAt: null, kind: { not: 'SYSTEM' } },
      select: { conversationId: true, senderId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return messages.map((m) => ({ otherId: otherOf.get(m.conversationId) as string, at: m.createdAt, mine: m.senderId === userId }));
  }

  async countSentSince(userId: string, since: Date): Promise<number> {
    if (!isUuid(userId)) return 0;
    return this.prisma.message.count({ where: { senderId: userId, createdAt: { gte: since } } });
  }

  async postEventConversationIds(postId: string, senderId: string): Promise<string[]> {
    if (!isUuid(postId) || !isUuid(senderId)) return [];
    const rows = await this.prisma.message.findMany({ where: { postEventId: postId, senderId, deletedAt: null }, select: { conversationId: true }, distinct: ['conversationId'], take: 200 });
    return rows.map((r) => r.conversationId);
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
