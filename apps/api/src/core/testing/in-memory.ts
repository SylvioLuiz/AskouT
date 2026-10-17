import { createHash } from 'node:crypto';
import { conflict } from '../errors.ts';
import { evaluateFriendship } from '../friendship.ts';
import type {
  PostRepository,
  EventRoomRepository,
  ConversationRepository,
  MeetupRepository,
  SchedulingRepository,
  NotificationRepository,
  PushMessage,
  PushResult,
  PushSender,
  PushSubscriptionRepository,
  ProfileEventRepository,
  PlaceRepository,
  VenueClaimRepository,
  AdminRepository,
  PlaceSource,
  AvailabilityRepository,
  FlashRepository,
  BlockRepository,
  Clock,
  EmailSender,
  FollowRepository,
  IdGenerator,
  PendingSignupRepository,
  UserRepository,
  EventSearchQuery,
} from '../ports.ts';
import { compareMatches, countTags, fold, matchEvent, matchVenue, type EventMatch } from '../explore-match.ts';
import { distanceMeters } from '../geo.ts';
import type { PollConfirmationRecord, PollParticipantRecord, PollProposalRecord, PollProposalStatus, PollRecord, PollStatus, PollVoteRecord, EventAttendanceRecord, EventPostRecord, EventRef, PostCommentRecord, PostPatch, PostReportRecord, PostScope, PostKindFilter, PostImageRecord, PostRecord, PostTagRecord, PostTagStatus, PostWithImages, ProfilePhotoRecord, MeetupRecord, NotificationRecord, PushSubscriptionRecord, ConversationPrefsRecord, ConversationRecord, ConversationReportRecord, ConversationSummaryRecord, ExternalPlace, MessageReactionRecord, MessageRecord, PlaceEventRecord, SuggestionResponse, VenueRecord, VenueProfilePatch, VenueClaimRecord, ClaimStatus, AdminStats, AdminUserRow, AdminVenueRow, AdminPlaceEventRow, AdminPostRow, AdminPostReportRow, AdminConversationReportRow, AuditRecord, ReportResolution, UserStatus, AvailabilitySlotRecord, Direction, FlashHiddenRecord, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord, Follow, FollowStatus, Page, PendingSignup, Profile, User } from '../types.ts';
import { DELETED_BODY } from '../types.ts';

/**
 * Repositórios em memória. Servem para testar as regras sem banco e como
 * referência de comportamento para a implementação Prisma/Postgres.
 */

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();
  readonly profiles = new Map<string, Profile>();

  async create(user: User, profile: Profile): Promise<void> {
    for (const existing of this.users.values()) {
      if (existing.email === user.email) throw conflict('Este e-mail já está em uso', { email: 'Este e-mail já está em uso' });
    }
    for (const existing of this.profiles.values()) {
      if (existing.username === profile.username) {
        throw conflict('Este nome de usuário já está em uso', { username: 'Este nome de usuário já está em uso' });
      }
    }
    this.users.set(user.id, { ...user });
    this.profiles.set(profile.userId, { ...profile });
  }

  readonly photos = new Map<string, ProfilePhotoRecord>();

  async setPhoto(userId: string, photo: ProfilePhotoRecord | null): Promise<void> {
    if (photo) this.photos.set(userId, { ...photo, data: new Uint8Array(photo.data) });
    else this.photos.delete(userId);
  }

  async findPhoto(userId: string): Promise<ProfilePhotoRecord | undefined> {
    const p = this.photos.get(userId);
    return p ? { ...p, data: new Uint8Array(p.data) } : undefined;
  }

  async findById(id: string): Promise<User | undefined> {
    const u = this.users.get(id);
    return u ? { ...u } : undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    for (const u of this.users.values()) if (u.email === email) return { ...u };
    return undefined;
  }

  async findIdsByEmailHashes(hashes: string[]): Promise<string[]> {
    const wanted = new Set(hashes);
    const out: string[] = [];
    for (const u of this.users.values()) {
      if (u.status === 'SUSPENDED') continue;
      if (wanted.has(createHash('sha256').update(u.email.toLowerCase(), 'utf8').digest('hex'))) out.push(u.id);
    }
    return out;
  }

  async findProfileById(userId: string): Promise<Profile | undefined> {
    const p = this.profiles.get(userId);
    return p ? { ...p } : undefined;
  }

  async findProfileByUsername(username: string): Promise<Profile | undefined> {
    for (const p of this.profiles.values()) if (p.username === username) return { ...p };
    return undefined;
  }

  async findProfilesByIds(ids: string[]): Promise<Profile[]> {
    const out: Profile[] = [];
    for (const id of ids) {
      const p = this.profiles.get(id);
      if (p && this.users.get(id)?.status !== 'SUSPENDED') out.push({ ...p });
    }
    return out;
  }

  async updateProfile(profile: Profile): Promise<void> {
    this.profiles.set(profile.userId, { ...profile });
  }

  async searchProfiles(query: string, limit: number, excludeIds: string[]): Promise<Profile[]> {
    const q = query.toLowerCase();
    const excluded = new Set(excludeIds);
    return [...this.profiles.values()]
      .filter((p) => !excluded.has(p.userId) && this.users.get(p.userId)?.status !== 'SUSPENDED')
      .filter((p) => p.username.startsWith(q) || p.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.username.localeCompare(b.username))
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }
}

export class InMemoryBlockRepository implements BlockRepository {
  /** chave "blockerId>blockedId" */
  readonly rows = new Map<string, Date>();

  async add(blockerId: string, blockedId: string, createdAt: Date): Promise<void> {
    const key = `${blockerId}>${blockedId}`;
    if (!this.rows.has(key)) this.rows.set(key, createdAt);
  }

  async remove(blockerId: string, blockedId: string): Promise<boolean> {
    return this.rows.delete(`${blockerId}>${blockedId}`);
  }

  async exists(blockerId: string, blockedId: string): Promise<boolean> {
    return this.rows.has(`${blockerId}>${blockedId}`);
  }

  async existsEitherWay(a: string, b: string): Promise<boolean> {
    return this.rows.has(`${a}>${b}`) || this.rows.has(`${b}>${a}`);
  }

  async listBlockedBy(blockerId: string): Promise<string[]> {
    return [...this.rows.keys()].filter((k) => k.startsWith(`${blockerId}>`)).map((k) => k.slice(blockerId.length + 1));
  }

  async listRelatedIds(userId: string): Promise<string[]> {
    const out = new Set<string>();
    for (const key of this.rows.keys()) {
      const [blocker, blocked] = key.split('>') as [string, string];
      if (blocker === userId) out.add(blocked);
      if (blocked === userId) out.add(blocker);
    }
    return [...out];
  }
}

export class InMemoryAvailabilityRepository implements AvailabilityRepository {
  readonly rows = new Map<string, AvailabilitySlotRecord>();

  async add(slot: AvailabilitySlotRecord): Promise<void> {
    for (const r of this.rows.values()) {
      if (r.userId === slot.userId && r.startsAt < slot.endsAt && slot.startsAt < r.endsAt) {
        throw conflict('Você já tem um horário neste período. Remova o outro antes.');
      }
    }
    this.rows.set(slot.id, { ...slot });
  }

  async delete(userId: string, slotId: string): Promise<boolean> {
    const r = this.rows.get(slotId);
    if (!r || r.userId !== userId) return false;
    return this.rows.delete(slotId);
  }

  async listForUsers(userIds: string[], from: Date, to: Date): Promise<AvailabilitySlotRecord[]> {
    const wanted = new Set(userIds);
    return [...this.rows.values()]
      .filter((r) => wanted.has(r.userId) && r.startsAt < to && from < r.endsAt)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id))
      .map((r) => ({ ...r }));
  }

  async countActive(userId: string, since: Date): Promise<number> {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.endsAt > since).length;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isOpen = (i: FlashInviteRecord) => i.status === 'PENDING' || i.status === 'ACCEPTED';

export class InMemoryFlashRepository implements FlashRepository {
  readonly sessions = new Map<string, FlashSessionRecord>();
  readonly invites = new Map<string, FlashInviteRecord>();
  readonly positions = new Map<string, FlashPositionRecord>();
  readonly hidden = new Map<string, FlashHiddenRecord>();

  private active(s: FlashSessionRecord, now: Date): boolean {
    return s.endedAt === null && s.expiresAt > now;
  }

  async findActiveSession(userId: string, now: Date): Promise<FlashSessionRecord | undefined> {
    for (const s of this.sessions.values()) if (s.userId === userId && this.active(s, now)) return { ...s };
    return undefined;
  }

  async listActiveSessions(userIds: string[], now: Date): Promise<FlashSessionRecord[]> {
    const wanted = new Set(userIds);
    return [...this.sessions.values()].filter((s) => wanted.has(s.userId) && this.active(s, now)).map((s) => ({ ...s }));
  }

  async createSession(session: FlashSessionRecord, now: Date): Promise<void> {
    for (const s of this.sessions.values()) {
      if (s.userId !== session.userId || s.endedAt !== null) continue;
      if (s.expiresAt <= now) s.endedAt = s.expiresAt;
      else throw conflict('Seu Flash já está ligado. Desligue para recomeçar.');
    }
    this.sessions.set(session.id, { ...session });
  }

  async endSession(userId: string, now: Date): Promise<boolean> {
    for (const s of this.sessions.values()) {
      if (s.userId === userId && this.active(s, now)) {
        s.endedAt = now;
        return true;
      }
    }
    return false;
  }

  private dropPositions(inviteId: string): number {
    let n = 0;
    for (const key of [...this.positions.keys()]) {
      if (key.startsWith(`${inviteId}|`)) {
        this.positions.delete(key);
        n += 1;
      }
    }
    return n;
  }

  private close(invite: FlashInviteRecord, endedAt: Date, accepted: 'ENDED' | 'EXPIRED', pending: 'CANCELED' | 'EXPIRED'): void {
    invite.status = invite.status === 'ACCEPTED' ? accepted : pending;
    invite.endedAt = endedAt;
    this.dropPositions(invite.id);
  }

  async createInvite(invite: FlashInviteRecord, now: Date): Promise<void> {
    for (const i of this.invites.values()) {
      const samePair =
        (i.fromUserId === invite.fromUserId && i.toUserId === invite.toUserId) ||
        (i.fromUserId === invite.toUserId && i.toUserId === invite.fromUserId);
      if (!samePair || !isOpen(i)) continue;
      if (i.expiresAt <= now) this.close(i, i.expiresAt, 'ENDED', 'EXPIRED');
      else throw conflict('Já existe um convite aberto entre vocês dois');
    }
    this.invites.set(invite.id, { ...invite });
  }

  async getInvite(id: string): Promise<FlashInviteRecord | undefined> {
    const i = this.invites.get(id);
    return i ? { ...i } : undefined;
  }

  async saveInvite(invite: FlashInviteRecord): Promise<void> {
    this.invites.set(invite.id, { ...invite });
    if (invite.status !== 'ACCEPTED') this.dropPositions(invite.id);
  }

  async listOpenInvitesFor(userId: string, now: Date): Promise<FlashInviteRecord[]> {
    return [...this.invites.values()]
      .filter((i) => (i.fromUserId === userId || i.toUserId === userId) && isOpen(i) && i.expiresAt > now)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((i) => ({ ...i }));
  }

  async closeOpenInvitesOf(userId: string, now: Date): Promise<number> {
    let n = 0;
    for (const i of this.invites.values()) {
      if ((i.fromUserId === userId || i.toUserId === userId) && isOpen(i)) {
        this.close(i, now, 'ENDED', 'CANCELED');
        n += 1;
      }
    }
    return n;
  }

  async closeOpenInvitesBetween(a: string, b: string, now: Date): Promise<number> {
    let n = 0;
    for (const i of this.invites.values()) {
      const pair = (i.fromUserId === a && i.toUserId === b) || (i.fromUserId === b && i.toUserId === a);
      if (pair && isOpen(i)) {
        this.close(i, now, 'ENDED', 'CANCELED');
        n += 1;
      }
    }
    return n;
  }

  async setHidden(record: FlashHiddenRecord): Promise<void> {
    const key = `${record.ownerId}|${record.otherId}`;
    if (record.hideTheirs || record.hideMine) this.hidden.set(key, { ...record });
    else this.hidden.delete(key);
  }

  async listHidden(userId: string): Promise<FlashHiddenRecord[]> {
    return [...this.hidden.values()].filter((r) => r.ownerId === userId || r.otherId === userId).map((r) => ({ ...r }));
  }

  async upsertPosition(position: FlashPositionRecord): Promise<void> {
    this.positions.set(`${position.inviteId}|${position.userId}`, { ...position });
  }

  async listPositions(inviteId: string): Promise<FlashPositionRecord[]> {
    return [...this.positions.values()].filter((p) => p.inviteId === inviteId).map((p) => ({ ...p }));
  }

  async purgeExpired(now: Date): Promise<{ invites: number; positions: number; removed: number }> {
    let invites = 0;
    for (const i of this.invites.values()) {
      if (isOpen(i) && i.expiresAt <= now) {
        this.close(i, i.expiresAt, 'ENDED', 'EXPIRED');
        invites += 1;
      }
    }
    let positions = 0;
    for (const key of [...this.positions.keys()]) {
      const inviteId = key.split('|')[0] as string;
      if (this.invites.get(inviteId)?.status !== 'ACCEPTED') {
        this.positions.delete(key);
        positions += 1;
      }
    }
    let removed = 0;
    const cutoff = now.getTime() - DAY_MS;
    for (const [id, s] of this.sessions) {
      if (s.endedAt !== null || s.expiresAt <= now) {
        if ((s.endedAt ?? s.expiresAt).getTime() < cutoff) {
          this.sessions.delete(id);
          removed += 1;
        }
      }
    }
    for (const [id, i] of this.invites) {
      if (!isOpen(i) && i.endedAt !== null && i.endedAt.getTime() < cutoff) {
        this.invites.delete(id);
        removed += 1;
      }
    }
    return { invites, positions, removed };
  }
}

export class InMemoryFollowRepository implements FollowRepository {
  readonly rows = new Map<string, Follow>();
  private readonly blocks: BlockRepository;

  constructor(blocks: BlockRepository) {
    this.blocks = blocks;
  }

  private key(followerId: string, followeeId: string): string {
    return `${followerId}>${followeeId}`;
  }

  async get(followerId: string, followeeId: string): Promise<Follow | undefined> {
    const f = this.rows.get(this.key(followerId, followeeId));
    return f ? { ...f } : undefined;
  }

  async save(follow: Follow): Promise<void> {
    const key = this.key(follow.followerId, follow.followeeId);
    const existing = this.rows.get(key);
    this.rows.set(key, { ...follow, createdAt: existing?.createdAt ?? follow.createdAt });
  }

  async delete(followerId: string, followeeId: string): Promise<boolean> {
    return this.rows.delete(this.key(followerId, followeeId));
  }

  async deleteBetween(a: string, b: string): Promise<void> {
    this.rows.delete(this.key(a, b));
    this.rows.delete(this.key(b, a));
  }

  async list(userId: string, direction: Direction, status: FollowStatus, page: Page): Promise<Follow[]> {
    return this.matching(userId, direction, status)
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime() || x.followerId.localeCompare(y.followerId))
      .slice(page.offset, page.offset + page.limit)
      .map((f) => ({ ...f }));
  }

  async count(userId: string, direction: Direction, status: FollowStatus): Promise<number> {
    return this.matching(userId, direction, status).length;
  }

  async acceptAllPending(followeeId: string): Promise<number> {
    let n = 0;
    for (const [key, f] of this.rows) {
      if (f.followeeId === followeeId && f.status === 'PENDING') {
        this.rows.set(key, { ...f, status: 'ACCEPTED' });
        n += 1;
      }
    }
    return n;
  }

  async listFriendIds(userId: string): Promise<string[]> {
    const out: string[] = [];
    for (const f of this.rows.values()) {
      if (f.followerId !== userId) continue;
      const back = this.rows.get(this.key(f.followeeId, userId));
      const blocked = await this.blocks.existsEitherWay(userId, f.followeeId);
      if (evaluateFriendship(f, back, blocked)) out.push(f.followeeId);
    }
    return out;
  }

  private matching(userId: string, direction: Direction, status: FollowStatus): Follow[] {
    return [...this.rows.values()].filter(
      (f) => f.status === status && (direction === 'followers' ? f.followeeId === userId : f.followerId === userId),
    );
  }
}

export class InMemoryPendingSignupRepository implements PendingSignupRepository {
  readonly rows = new Map<string, PendingSignup>();

  async find(email: string): Promise<PendingSignup | undefined> {
    const p = this.rows.get(email);
    return p ? { ...p } : undefined;
  }

  async save(pending: PendingSignup): Promise<void> {
    this.rows.set(pending.email, { ...pending });
  }

  async delete(email: string): Promise<void> {
    this.rows.delete(email);
  }

  async incrementAttempts(email: string): Promise<number | undefined> {
    const p = this.rows.get(email);
    if (!p) return undefined;
    p.attempts += 1;
    return p.attempts;
  }
}

/** Guarda os e-mails "enviados" para os testes lerem o código. */
export class FakeEmailSender implements EmailSender {
  readonly sent: { to: string; code: string; expiresInMinutes: number }[] = [];
  failNext = false;

  async sendSignupCode(input: { to: string; code: string; expiresInMinutes: number }): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('falha simulada no envio de e-mail');
    }
    this.sent.push({ ...input });
  }

  lastCodeFor(email: string): string {
    for (let i = this.sent.length - 1; i >= 0; i -= 1) {
      const m = this.sent[i]!;
      if (m.to === email) return m.code;
    }
    throw new Error(`nenhum e-mail enviado para ${email}`);
  }
}

/** Relógio controlável: cada chamada a tick() avança o tempo. */
export class FakeClock implements Clock {
  private current: number;

  constructor(startIso = '2026-10-13T12:00:00.000Z') {
    this.current = Date.parse(startIso);
  }

  now(): Date {
    return new Date(this.current);
  }

  tick(ms = 1000): void {
    this.current += ms;
  }
}

export class SequentialIds implements IdGenerator {
  private n = 0;

  next(): string {
    this.n += 1;
    return `id-${this.n}`;
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, ConversationRecord>();
  readonly participants = new Map<string, Map<string, Date | null>>();
  readonly cleared = new Map<string, Date>();
  readonly reports = new Map<string, ConversationReportRecord>();
  readonly messages: MessageRecord[] = [];
  readonly prefs = new Map<string, ConversationPrefsRecord>();
  readonly reactions = new Map<string, MessageReactionRecord>();
  private medias = new Map<string, { mime: string; data: Uint8Array }>();

  async getOrCreateDirect(a: string, b: string, id: string, now: Date): Promise<ConversationRecord> {
    const directKey = a < b ? `${a}:${b}` : `${b}:${a}`;
    for (const c of this.conversations.values()) if (c.directKey === directKey) return { ...c };
    const record: ConversationRecord = { id, type: 'DIRECT', directKey, name: null, ownerId: null, imageUrl: null, createdAt: now };
    this.conversations.set(id, record);
    this.participants.set(id, new Map([[a, null], [b, null]]));
    return { ...record };
  }

  async findById(id: string): Promise<ConversationRecord | undefined> {
    const c = this.conversations.get(id);
    return c ? { ...c } : undefined;
  }

  async participantIds(conversationId: string): Promise<string[] | undefined> {
    const p = this.participants.get(conversationId);
    return p ? [...p.keys()] : undefined;
  }

  async createGroup(input: { id: string; name: string; ownerId: string; now: Date }): Promise<ConversationRecord> {
    const record: ConversationRecord = { id: input.id, type: 'GROUP', directKey: null, name: input.name, ownerId: input.ownerId, imageUrl: null, createdAt: input.now };
    this.conversations.set(input.id, record);
    this.participants.set(input.id, new Map([[input.ownerId, null]]));
    return { ...record };
  }

  async addParticipant(conversationId: string, userId: string, now: Date): Promise<void> {
    const p = this.participants.get(conversationId);
    if (p && !p.has(userId)) p.set(userId, null);
    void now;
  }

  private readonly groupAdmins = new Map<string, Set<string>>();

  async removeParticipant(conversationId: string, userId: string): Promise<void> {
    this.participants.get(conversationId)?.delete(userId);
    this.groupAdmins.get(conversationId)?.delete(userId);
  }

  async adminIds(conversationId: string): Promise<string[]> {
    return [...(this.groupAdmins.get(conversationId) ?? [])];
  }

  async setAdmin(conversationId: string, userId: string, admin: boolean): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (!c || c.type !== 'GROUP' || c.ownerId === userId || !this.participants.get(conversationId)?.has(userId)) return;
    const set = this.groupAdmins.get(conversationId) ?? new Set<string>();
    if (admin) set.add(userId);
    else set.delete(userId);
    this.groupAdmins.set(conversationId, set);
  }

  async updateGroup(conversationId: string, patch: { name?: string; imageUrl?: string | null; ownerId?: string }): Promise<void> {
    const c = this.conversations.get(conversationId);
    if (!c || c.type !== 'GROUP') return;
    if (patch.name !== undefined) c.name = patch.name;
    if (patch.imageUrl !== undefined) c.imageUrl = patch.imageUrl;
    if (patch.ownerId !== undefined) {
      c.ownerId = patch.ownerId;
      this.groupAdmins.get(conversationId)?.delete(patch.ownerId);
    }
  }

  async listForUser(userId: string, hiddenSenderIds: readonly string[] = []): Promise<ConversationSummaryRecord[]> {
    const out: ConversationSummaryRecord[] = [];
    for (const [id, p] of this.participants) {
      if (!p.has(userId)) continue;
      const clearedAt = this.cleared.get(`${id}|${userId}`) ?? null;
      const msgs = this.messages.filter((m) => m.conversationId === id && !hiddenSenderIds.includes(m.senderId) && (clearedAt === null || m.createdAt > clearedAt));
      const lastRead = p.get(userId) ?? null;
      const unread = msgs.filter((m) => m.senderId !== userId && (lastRead === null || m.createdAt > lastRead)).length;
      const pref = this.prefs.get(`${id}|${userId}`);
      out.push({ conversation: { ...this.conversations.get(id)! }, participantIds: [...p.keys()], lastMessage: msgs.at(-1) ?? null, unread, pinnedAt: pref?.pinnedAt ?? null, muted: pref?.muted ?? false });
    }
    const stamp = (s: ConversationSummaryRecord) => (s.lastMessage ?? s.conversation).createdAt.getTime();
    return out.sort((a, b) => stamp(b) - stamp(a));
  }

  private audios = new Map<string, { mime: string; data: Uint8Array }>();

  async addMessage(message: MessageRecord, attachment?: { mime: string; data: Uint8Array }): Promise<void> {
    this.messages.push({ ...message });
    if (!attachment) return;
    const copy = { mime: attachment.mime, data: new Uint8Array(attachment.data) };
    if (message.kind === 'AUDIO') this.audios.set(message.id, copy);
    else this.medias.set(message.id, copy);
  }

  async findMedia(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    const a = this.medias.get(messageId);
    return a ? { mime: a.mime, data: new Uint8Array(a.data) } : undefined;
  }

  async softDeleteMessage(messageId: string, at: Date): Promise<boolean> {
    const m = this.messages.find((x) => x.id === messageId);
    if (!m || m.deletedAt) return false;
    m.deletedAt = at;
    m.body = DELETED_BODY;
    this.audios.delete(messageId);
    this.medias.delete(messageId);
    for (const key of [...this.reactions.keys()]) if (key.startsWith(`${messageId}|`)) this.reactions.delete(key);
    return true;
  }

  async setReaction(messageId: string, userId: string, emoji: string | null, at: Date): Promise<void> {
    void at;
    const key = `${messageId}|${userId}`;
    if (emoji === null) this.reactions.delete(key);
    else this.reactions.set(key, { messageId, userId, emoji });
  }

  async listReactions(messageIds: readonly string[]): Promise<MessageReactionRecord[]> {
    const wanted = new Set(messageIds);
    return [...this.reactions.values()].filter((r) => wanted.has(r.messageId)).map((r) => ({ ...r })).sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  }

  async setPrefs(conversationId: string, userId: string, patch: { pinnedAt?: Date | null; muted?: boolean }): Promise<void> {
    if (!this.participants.get(conversationId)?.has(userId)) return;
    const key = `${conversationId}|${userId}`;
    const current = this.prefs.get(key) ?? { pinnedAt: null, muted: false };
    this.prefs.set(key, { pinnedAt: patch.pinnedAt === undefined ? current.pinnedAt : patch.pinnedAt, muted: patch.muted ?? current.muted });
  }

  async getPrefs(conversationId: string, userId: string): Promise<ConversationPrefsRecord> {
    return { ...(this.prefs.get(`${conversationId}|${userId}`) ?? { pinnedAt: null, muted: false }) };
  }

  async countPinned(userId: string): Promise<number> {
    return [...this.prefs.entries()].filter(([key, v]) => key.endsWith(`|${userId}`) && v.pinnedAt !== null && this.participants.get(key.split('|')[0] as string)?.has(userId)).length;
  }

  async mutedUserIds(conversationId: string): Promise<string[]> {
    return [...this.prefs.entries()].filter(([key, v]) => key.startsWith(`${conversationId}|`) && v.muted).map(([key]) => key.split('|')[1] as string);
  }

  async findAudio(messageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    const a = this.audios.get(messageId);
    return a ? { mime: a.mime, data: new Uint8Array(a.data) } : undefined;
  }

  async findMessage(id: string): Promise<MessageRecord | undefined> {
    const m = this.messages.find((x) => x.id === id);
    return m ? { ...m } : undefined;
  }

  async setSuggestionResponse(messageId: string, response: SuggestionResponse, at: Date): Promise<boolean> {
    const m = this.messages.find((x) => x.id === messageId);
    if (!m || m.kind !== 'SUGGESTION' || m.response !== null) return false;
    m.response = response;
    m.respondedAt = at;
    return true;
  }

  async listMessages(conversationId: string, limit: number, before?: Date, excludeSenderIds: readonly string[] = [], after?: Date): Promise<MessageRecord[]> {
    const all = this.messages.filter((m) => m.conversationId === conversationId && (before === undefined || m.createdAt < before) && (after === undefined || m.createdAt > after) && !excludeSenderIds.includes(m.senderId));
    return all.slice(Math.max(0, all.length - limit)).map((m) => ({ ...m }));
  }

  async setCleared(conversationId: string, userId: string, at: Date): Promise<void> {
    if (this.participants.get(conversationId)?.has(userId)) this.cleared.set(`${conversationId}|${userId}`, at);
  }

  async getCleared(conversationId: string, userId: string): Promise<Date | null> {
    return this.cleared.get(`${conversationId}|${userId}`) ?? null;
  }

  async addReport(report: ConversationReportRecord): Promise<void> {
    this.reports.set(`${report.conversationId}|${report.reporterId}`, { ...report });
  }

  async listShared(conversationId: string, limit: number, excludeSenderIds: readonly string[] = [], after?: Date): Promise<MessageRecord[]> {
    return this.messages
      .filter((m) => m.conversationId === conversationId && !excludeSenderIds.includes(m.senderId) && (after === undefined || m.createdAt > after) && !m.deletedAt && (m.kind === 'AUDIO' || m.kind === 'IMAGE' || m.kind === 'VIDEO' || (m.kind === 'TEXT' && /https?:\/\//i.test(m.body))))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((m) => ({ ...m }));
  }

  async markRead(conversationId: string, userId: string, now: Date): Promise<void> {
    const p = this.participants.get(conversationId);
    if (p?.has(userId)) p.set(userId, now);
  }

  async countSentSince(userId: string, since: Date): Promise<number> {
    return this.messages.filter((m) => m.senderId === userId && m.createdAt >= since).length;
  }

  async hasPostEventAccess(userId: string, postId: string): Promise<boolean> {
    return this.messages.some((m) => m.postEventId === postId && this.participants.get(m.conversationId)?.has(userId));
  }
}

export class InMemoryMeetupRepository implements MeetupRepository {
  readonly meetups = new Map<string, MeetupRecord>();

  private copy(m: MeetupRecord): MeetupRecord {
    return { ...m, participants: m.participants.map((p) => ({ ...p })) };
  }

  async create(meetup: MeetupRecord): Promise<void> {
    this.meetups.set(meetup.id, this.copy(meetup));
  }

  async find(id: string): Promise<MeetupRecord | undefined> {
    const m = this.meetups.get(id);
    return m ? this.copy(m) : undefined;
  }

  async listForConversation(conversationId: string): Promise<MeetupRecord[]> {
    return [...this.meetups.values()]
      .filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((m) => this.copy(m));
  }

  async respond(meetupId: string, userId: string, status: 'CONFIRMED' | 'DECLINED', at: Date): Promise<boolean> {
    const p = this.meetups.get(meetupId)?.participants.find((x) => x.userId === userId);
    if (!p || p.status !== 'INVITED') return false;
    p.status = status;
    p.respondedAt = at;
    return true;
  }

  async update(meetupId: string, patch: { title?: string; status?: 'ACTIVE' | 'CANCELLED'; eventPostId?: string }): Promise<void> {
    const m = this.meetups.get(meetupId);
    if (!m) return;
    if (patch.eventPostId !== undefined) m.eventPostId = patch.eventPostId;
    if (patch.title !== undefined) m.title = patch.title;
    if (patch.status !== undefined) m.status = patch.status;
  }

  async renameForEventPost(postId: string, title: string): Promise<void> {
    for (const m of this.meetups.values()) if (m.eventPostId === postId) m.title = title;
  }

  async invite(meetupId: string, userIds: string[]): Promise<string[]> {
    const m = this.meetups.get(meetupId);
    if (!m) return [];
    const done: string[] = [];
    for (const userId of userIds) {
      const p = m.participants.find((x) => x.userId === userId);
      if (!p) {
        m.participants.push({ userId, status: 'INVITED', respondedAt: null });
        done.push(userId);
      } else if (p.status === 'DECLINED') {
        p.status = 'INVITED';
        p.respondedAt = null;
        done.push(userId);
      }
    }
    return done;
  }

  async declineAllFor(conversationId: string, userId: string, at: Date): Promise<void> {
    for (const m of this.meetups.values()) {
      if (m.conversationId !== conversationId || m.organizerId === userId) continue;
      const p = m.participants.find((x) => x.userId === userId);
      if (p && p.status !== 'DECLINED') {
        p.status = 'DECLINED';
        p.respondedAt = at;
      }
    }
  }

  async listForUser(userId: string, limit: number): Promise<MeetupRecord[]> {
    return [...this.meetups.values()]
      .filter((m) => m.organizerId === userId || m.participants.some((p) => p.userId === userId))
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((m) => this.copy(m));
  }

  async countCreatedSince(userId: string, since: Date): Promise<number> {
    return [...this.meetups.values()].filter((m) => m.organizerId === userId && m.createdAt >= since).length;
  }
}

export class InMemoryPlaceRepository implements PlaceRepository {
  readonly venues = new Map<string, VenueRecord>();
  readonly events = new Map<string, PlaceEventRecord>();
  readonly covers = new Map<string, { mime: string; data: Uint8Array }>();
  readonly venueCovers = new Map<string, { mime: string; data: Uint8Array }>();
  readonly venueLogos = new Map<string, { mime: string; data: Uint8Array }>();
  readonly venueFollows = new Map<string, Date>();
  readonly venueRatings = new Map<string, number>();

  async updateVenueProfile(venueId: string, patch: VenueProfilePatch) {
    const v = this.venues.get(venueId);
    if (v) this.venues.set(venueId, { ...v, ...patch, hours: patch.hours ? patch.hours.map((d) => (d ? { ...d } : null)) : null });
  }

  async setVenueCover(venueId: string, mime: string, data: Uint8Array) {
    if (this.venues.has(venueId)) this.venueCovers.set(venueId, { mime, data: new Uint8Array(data) });
  }

  async clearVenueCover(venueId: string) {
    this.venueCovers.delete(venueId);
  }

  async findVenueCover(venueId: string) {
    const c = this.venueCovers.get(venueId);
    return c ? { mime: c.mime, data: new Uint8Array(c.data) } : undefined;
  }

  async setVenueLogo(venueId: string, mime: string, data: Uint8Array) {
    if (this.venues.has(venueId)) this.venueLogos.set(venueId, { mime, data: new Uint8Array(data) });
  }

  async clearVenueLogo(venueId: string) {
    this.venueLogos.delete(venueId);
  }

  async findVenueLogo(venueId: string) {
    const c = this.venueLogos.get(venueId);
    return c ? { mime: c.mime, data: new Uint8Array(c.data) } : undefined;
  }

  async findVenueByExternalKey(key: string) {
    for (const v of this.venues.values()) if (v.externalKey === key) return { ...v };
    return undefined;
  }

  async followVenue(userId: string, venueId: string, at: Date) {
    if (!this.venues.has(venueId)) return;
    const key = `${userId}|${venueId}`;
    if (!this.venueFollows.has(key)) this.venueFollows.set(key, at);
  }

  async unfollowVenue(userId: string, venueId: string) {
    this.venueFollows.delete(`${userId}|${venueId}`);
  }

  async isFollowingVenue(userId: string, venueId: string) {
    return this.venueFollows.has(`${userId}|${venueId}`);
  }

  async countVenueFollowers(venueId: string) {
    return [...this.venueFollows.keys()].filter((k) => k.endsWith(`|${venueId}`)).length;
  }

  async listFollowedVenueIds(userId: string) {
    return [...this.venueFollows.keys()].filter((k) => k.startsWith(`${userId}|`)).map((k) => k.slice(userId.length + 1));
  }

  async rateVenue(userId: string, venueId: string, stars: number) {
    if (!this.venues.has(venueId)) return;
    this.venueRatings.set(`${userId}|${venueId}`, stars);
  }

  async clearVenueRating(userId: string, venueId: string) {
    this.venueRatings.delete(`${userId}|${venueId}`);
  }

  async venueRating(venueId: string, userId: string) {
    let count = 0;
    let sum = 0;
    for (const [k, v] of this.venueRatings) {
      if (k.endsWith(`|${venueId}`)) {
        count += 1;
        sum += v;
      }
    }
    return { count, sum, mine: this.venueRatings.get(`${userId}|${venueId}`) ?? null };
  }

  async createVenue(venue: VenueRecord): Promise<void> {
    this.venues.set(venue.id, { ...venue, ownerId: venue.ownerId ?? null });
  }

  async findVenue(id: string) {
    const v = this.venues.get(id);
    return v ? { ...v } : undefined;
  }

  async listVenuesByOwner(ownerId: string) {
    return [...this.venues.values()].filter((v) => v.ownerId === ownerId).map((v) => ({ ...v })).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  }

  async listVenueEvents(venueId: string) {
    return [...this.events.values()].filter((e) => e.venueId === venueId).map((e) => ({ ...e, tags: [...e.tags] })).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? -1 : 1));
  }

  async updateEvent(venueId: string, event: PlaceEventRecord) {
    const current = this.events.get(event.id);
    if (!current || current.venueId !== venueId) return false;
    this.events.set(event.id, { ...event, venueId, isSample: current.isSample, tags: [...event.tags] });
    return true;
  }

  async deleteEvent(venueId: string, eventId: string) {
    const current = this.events.get(eventId);
    if (!current || current.venueId !== venueId) return false;
    this.events.delete(eventId);
    this.covers.delete(eventId);
    return true;
  }

  async setEventCover(eventId: string, mime: string, data: Uint8Array) {
    if (this.events.has(eventId)) this.covers.set(eventId, { mime, data: new Uint8Array(data) });
  }

  async clearEventCover(eventId: string) {
    this.covers.delete(eventId);
  }

  async findEventCover(eventId: string) {
    const c = this.covers.get(eventId);
    return c ? { mime: c.mime, data: new Uint8Array(c.data) } : undefined;
  }

  async setVenueOwner(venueId: string, ownerId: string | null) {
    const v = this.venues.get(venueId);
    if (v) this.venues.set(venueId, { ...v, ownerId });
  }

  async createEvent(event: PlaceEventRecord): Promise<void> {
    this.events.set(event.id, { ...event, tags: [...event.tags] });
  }

  async findEventsNear(center: { lat: number; lng: number }, radiusM: number, from: Date, to: Date, limit: number) {
    const rows: { event: PlaceEventRecord; venue: VenueRecord; d: number }[] = [];
    for (const event of this.events.values()) {
      const venue = this.venues.get(event.venueId);
      if (!venue) continue;
      // Em andamento ou começando no intervalo: termina depois de `from` e começa antes de `to`.
      if (!(event.endsAt > from && event.startsAt < to)) continue;
      const d = distanceMeters(center, venue);
      if (d <= radiusM) rows.push({ event: { ...event }, venue: { ...venue }, d });
    }
    rows.sort((a, b) => a.d - b.d || a.event.startsAt.getTime() - b.event.startsAt.getTime() || (a.event.id < b.event.id ? -1 : 1));
    return rows.slice(0, limit).map(({ event, venue }) => ({ event, venue }));
  }

  async searchEvents(query: EventSearchQuery) {
    const out: EventMatch[] = [];
    for (const event of this.events.values()) {
      const venue = this.venues.get(event.venueId);
      if (!venue) continue;
      const m = matchEvent(event, venue, query);
      if (m) out.push(m);
    }
    return out.sort(compareMatches).slice(0, query.limit);
  }

  async findEvent(id: string) {
    const event = this.events.get(id);
    const venue = event ? this.venues.get(event.venueId) : undefined;
    return event && venue ? { event: { ...event, tags: [...event.tags] }, venue: { ...venue } } : undefined;
  }

  async listTags(prefix: string, from: Date, to: Date, limit: number) {
    const live = [...this.events.values()].filter((e) => e.endsAt > from && e.startsAt < to);
    return countTags(live, prefix, limit);
  }

  async searchVenues(text: string, center: { lat: number; lng: number } | undefined, radiusM: number, limit: number) {
    const out: { venue: VenueRecord; distanceM: number | null }[] = [];
    for (const venue of this.venues.values()) {
      const m = matchVenue(venue, text, center, radiusM);
      if (m) out.push(m);
    }
    return out.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) || (a.venue.id < b.venue.id ? -1 : 1)).slice(0, limit);
  }
}

export class InMemoryVenueClaimRepository implements VenueClaimRepository {
  readonly claims = new Map<string, VenueClaimRecord>();
  readonly documents = new Map<string, { mime: string; data: Uint8Array }>();

  async create(claim: VenueClaimRecord, document: Uint8Array): Promise<void> {
    this.claims.set(claim.id, { ...claim });
    this.documents.set(claim.id, { mime: claim.documentMime, data: new Uint8Array(document) });
  }

  async findById(id: string) {
    const c = this.claims.get(id);
    return c ? { ...c } : undefined;
  }

  async listByUser(userId: string) {
    return [...this.claims.values()].filter((c) => c.userId === userId).map((c) => ({ ...c })).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
  }

  async listByStatus(status: ClaimStatus, limit: number) {
    return [...this.claims.values()].filter((c) => c.status === status).map((c) => ({ ...c })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1)).slice(0, limit);
  }

  async hasPending(venueId: string, userId: string) {
    return [...this.claims.values()].some((c) => c.venueId === venueId && c.userId === userId && c.status === 'PENDING');
  }

  async review(id: string, status: 'APPROVED' | 'REJECTED', reviewerId: string, reviewNote: string | null, at: Date) {
    const c = this.claims.get(id);
    if (!c || c.status !== 'PENDING') return false;
    this.claims.set(id, { ...c, status, reviewedBy: reviewerId, reviewNote, reviewedAt: at });
    return true;
  }

  async findDocument(id: string) {
    const d = this.documents.get(id);
    return d ? { mime: d.mime, data: new Uint8Array(d.data) } : undefined;
  }
}

/** Fonte de lugares falsa para testes: devolve o que for configurado. */
export class FakePlaceSource implements PlaceSource {
  places: ExternalPlace[] = [];
  available = true;
  calls = 0;

  async nearby(): Promise<{ available: boolean; places: ExternalPlace[] }> {
    this.calls += 1;
    return this.available ? { available: true, places: this.places.map((p) => ({ ...p })) } : { available: false, places: [] };
  }
}

export class InMemoryProfileEventRepository implements ProfileEventRepository {
  readonly rows = new Map<string, { userId: string; eventId: string; createdAt: Date }>();

  private key(userId: string, eventId: string): string {
    return `${userId}|${eventId}`;
  }

  async add(userId: string, eventId: string, at: Date): Promise<boolean> {
    const key = this.key(userId, eventId);
    if (this.rows.has(key)) return false;
    this.rows.set(key, { userId, eventId, createdAt: at });
    return true;
  }

  async remove(userId: string, eventId: string): Promise<boolean> {
    return this.rows.delete(this.key(userId, eventId));
  }

  async has(userId: string, eventId: string): Promise<boolean> {
    return this.rows.has(this.key(userId, eventId));
  }

  readonly postRows = new Map<string, { userId: string; postId: string; createdAt: Date }>();

  async addPost(userId: string, postId: string, at: Date): Promise<boolean> {
    const key = this.key(userId, postId);
    if (this.postRows.has(key)) return false;
    this.postRows.set(key, { userId, postId, createdAt: at });
    return true;
  }

  async removePost(userId: string, postId: string): Promise<boolean> {
    return this.postRows.delete(this.key(userId, postId));
  }

  async hasPost(userId: string, postId: string): Promise<boolean> {
    return this.postRows.has(this.key(userId, postId));
  }

  async list(userId: string, page: Page): Promise<{ eventId: string; postId?: string; createdAt: Date }[]> {
    const places = [...this.rows.values()].filter((r) => r.userId === userId).map((r) => ({ eventId: r.eventId, createdAt: r.createdAt }));
    const people = [...this.postRows.values()].filter((r) => r.userId === userId).map((r) => ({ eventId: r.postId, postId: r.postId, createdAt: r.createdAt }));
    return [...places, ...people]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.eventId < b.eventId ? 1 : -1))
      .slice(page.offset ?? 0, (page.offset ?? 0) + (page.limit ?? 50));
  }

  async count(userId: string): Promise<number> {
    return [...this.rows.values()].filter((r) => r.userId === userId).length + [...this.postRows.values()].filter((r) => r.userId === userId).length;
  }
}

export class InMemoryNotificationRepository implements NotificationRepository {
  readonly rows: NotificationRecord[] = [];

  async create(record: NotificationRecord): Promise<void> {
    this.rows.push({ ...record });
  }

  async listForUser(userId: string, limit: number): Promise<NotificationRecord[]> {
    return this.rows
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, limit)
      .map((n) => ({ ...n }));
  }

  async unreadCount(userId: string): Promise<number> {
    return this.rows.filter((n) => n.userId === userId && n.readAt === null).length;
  }

  async hasUnread(userId: string, dedupeKey: string): Promise<boolean> {
    return this.rows.some((n) => n.userId === userId && n.readAt === null && n.dedupeKey === dedupeKey);
  }

  async markRead(userId: string, now: Date, ids?: string[]): Promise<number> {
    let changed = 0;
    for (const n of this.rows) {
      if (n.userId !== userId || n.readAt !== null) continue;
      if (ids && !ids.includes(n.id)) continue;
      n.readAt = now;
      changed += 1;
    }
    return changed;
  }
}

export class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  readonly rows = new Map<string, PushSubscriptionRecord>();

  async upsert(record: PushSubscriptionRecord): Promise<void> {
    const existing = this.rows.get(record.endpoint);
    this.rows.set(record.endpoint, { ...record, createdAt: existing?.createdAt ?? record.createdAt });
  }

  async remove(endpoint: string, userId?: string): Promise<void> {
    const row = this.rows.get(endpoint);
    if (row && (userId === undefined || row.userId === userId)) this.rows.delete(endpoint);
  }

  async listForUser(userId: string): Promise<PushSubscriptionRecord[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((r) => ({ ...r }));
  }
}

/** Guarda o que seria enviado; `results` permite simular inscrição vencida ou falha. */
export class FakePushSender implements PushSender {
  publicKey: string | null = 'chave-publica-de-teste';
  readonly sent: { subscription: PushSubscriptionRecord; message: PushMessage }[] = [];
  results = new Map<string, PushResult>();

  async send(subscription: PushSubscriptionRecord, message: PushMessage): Promise<PushResult> {
    this.sent.push({ subscription, message });
    return this.results.get(subscription.endpoint) ?? 'SENT';
  }
}

export class InMemoryPostRepository implements PostRepository {
  readonly posts = new Map<string, PostRecord>();
  readonly images = new Map<string, PostImageRecord>();

  async create(post: PostRecord, images: PostImageRecord[]): Promise<void> {
    this.posts.set(post.id, { ...post });
    for (const i of images) this.images.set(i.id, { ...i, data: i.data ? new Uint8Array(i.data) : null });
  }

  private withImages(post: PostRecord): PostWithImages {
    const images = [...this.images.values()]
      .filter((i) => i.postId === post.id)
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ id: i.id, position: i.position, isUpload: i.data !== null, placePhotoRef: i.placePhotoRef, placePhotoAuthor: i.placePhotoAuthor }));
    return { post: { ...post }, images };
  }

  async findById(id: string): Promise<PostWithImages | undefined> {
    const post = this.posts.get(id);
    return post ? this.withImages(post) : undefined;
  }

  readonly tags = new Map<string, PostTagRecord>();

  readonly hidden = new Set<string>();
  readonly likes = new Map<string, Date>();
  readonly comments = new Map<string, PostCommentRecord>();
  readonly reports = new Map<string, PostReportRecord>();

  private visibleFor(authorIds: string[], taggedIds: string[], scope: PostScope = {}): PostRecord[] {
    const authors = new Set(authorIds);
    const tagged = new Set(taggedIds);
    const viaTag = new Set([...this.tags.values()].filter((t) => t.status === 'ACCEPTED' && tagged.has(t.userId)).map((t) => t.postId));
    const venues = new Set(scope.venueIds ?? []);
    return [...this.posts.values()].filter(
      (p) =>
        (p.venueId ? venues.has(p.venueId) : authors.has(p.authorId) || viaTag.has(p.id)) &&
        (scope.archived ? p.archivedAt !== null : p.archivedAt === null) &&
        !(scope.hideFor && this.hidden.has(`${p.id}|${scope.hideFor}`)),
    );
  }

  private newestFirst(posts: PostRecord[]): PostRecord[] {
    return posts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1));
  }

  private static matches(p: PostRecord, only?: PostKindFilter): boolean {
    return only === undefined || (only === 'EVENT') === (p.eventTitle !== null);
  }

  async listFor(authorIds: string[], taggedIds: string[], page: Page, only?: PostKindFilter, scope?: PostScope): Promise<PostWithImages[]> {
    return this.newestFirst(this.visibleFor(authorIds, taggedIds, scope).filter((p) => InMemoryPostRepository.matches(p, only)))
      .slice(page.offset, page.offset + page.limit)
      .map((p) => this.withImages(p));
  }

  async countFor(userId: string, only?: PostKindFilter): Promise<number> {
    return this.visibleFor([userId], [userId]).filter((p) => InMemoryPostRepository.matches(p, only)).length;
  }

  async createTags(postId: string, userIds: string[], at: Date): Promise<void> {
    for (const userId of userIds) {
      const key = `${postId}|${userId}`;
      if (!this.tags.has(key)) this.tags.set(key, { postId, userId, status: 'PENDING', createdAt: at });
    }
  }

  async tagsFor(postIds: string[]): Promise<PostTagRecord[]> {
    const set = new Set(postIds);
    return [...this.tags.values()].filter((t) => set.has(t.postId)).map((t) => ({ ...t }));
  }

  async respondTag(postId: string, userId: string, status: PostTagStatus): Promise<boolean> {
    const tag = this.tags.get(`${postId}|${userId}`);
    if (!tag) return false;
    tag.status = status;
    return true;
  }

  async listPendingTags(userId: string, page: Page): Promise<PostWithImages[]> {
    const ids = new Set([...this.tags.values()].filter((t) => t.userId === userId && t.status === 'PENDING').map((t) => t.postId));
    return this.newestFirst([...this.posts.values()].filter((p) => ids.has(p.id)))
      .slice(page.offset, page.offset + page.limit)
      .map((p) => this.withImages(p));
  }

  async delete(postId: string, authorId: string): Promise<boolean> {
    const post = this.posts.get(postId);
    if (!post || post.authorId !== authorId) return false;
    this.posts.delete(postId);
    for (const [key, t] of this.tags) if (t.postId === postId) this.tags.delete(key);
    for (const [id, i] of this.images) if (i.postId === postId) this.images.delete(id);
    for (const key of [...this.likes.keys()]) if (key.startsWith(`${postId}|`)) this.likes.delete(key);
    for (const [id, c] of this.comments) if (c.postId === postId) this.comments.delete(id);
    for (const [key, r] of this.reports) if (r.postId === postId) this.reports.delete(key);
    for (const key of [...this.hidden]) if (key.startsWith(`${postId}|`)) this.hidden.delete(key);
    return true;
  }

  async update(postId: string, authorId: string, patch: PostPatch): Promise<boolean> {
    const post = this.posts.get(postId);
    if (!post || post.authorId !== authorId) return false;
    Object.assign(post, patch);
    return true;
  }

  async setArchived(postId: string, authorId: string, at: Date | null): Promise<boolean> {
    const post = this.posts.get(postId);
    if (!post || post.authorId !== authorId) return false;
    post.archivedAt = at;
    return true;
  }

  async listArchived(authorId: string, page: Page): Promise<PostWithImages[]> {
    return this.newestFirst([...this.posts.values()].filter((p) => p.authorId === authorId && p.archivedAt !== null))
      .slice(page.offset, page.offset + page.limit)
      .map((p) => this.withImages(p));
  }

  async replaceImage(postId: string, imageId: string, newId: string, mime: string, data: Uint8Array): Promise<boolean> {
    const image = this.images.get(imageId);
    if (!image || image.postId !== postId || image.data === null) return false;
    this.images.delete(imageId);
    this.images.set(newId, { ...image, id: newId, mime, data: new Uint8Array(data) });
    return true;
  }

  async hide(postId: string, userId: string): Promise<void> {
    this.hidden.add(`${postId}|${userId}`);
  }

  async like(postId: string, userId: string, at: Date): Promise<void> {
    const key = `${postId}|${userId}`;
    if (!this.likes.has(key)) this.likes.set(key, at);
  }

  async unlike(postId: string, userId: string): Promise<void> {
    this.likes.delete(`${postId}|${userId}`);
  }

  async likeStats(postIds: string[], viewerId: string): Promise<{ postId: string; count: number; liked: boolean }[]> {
    return postIds.map((postId) => ({
      postId,
      count: [...this.likes.keys()].filter((k) => k.startsWith(`${postId}|`)).length,
      liked: this.likes.has(`${postId}|${viewerId}`),
    }));
  }

  async addComment(comment: PostCommentRecord): Promise<void> {
    this.comments.set(comment.id, { ...comment });
  }

  async findComment(id: string): Promise<PostCommentRecord | undefined> {
    const c = this.comments.get(id);
    return c ? { ...c } : undefined;
  }

  async listComments(postId: string, page: Page): Promise<PostCommentRecord[]> {
    return [...this.comments.values()]
      .filter((c) => c.postId === postId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(page.offset, page.offset + page.limit)
      .map((c) => ({ ...c }));
  }

  async deleteComment(id: string): Promise<void> {
    this.comments.delete(id);
  }

  async commentCounts(postIds: string[]): Promise<{ postId: string; count: number }[]> {
    return postIds.map((postId) => ({ postId, count: [...this.comments.values()].filter((c) => c.postId === postId).length }));
  }

  async report(report: PostReportRecord): Promise<void> {
    this.reports.set(`${report.postId}|${report.reporterId}`, { ...report });
  }

  async findImage(imageId: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    const i = this.images.get(imageId);
    return i && i.data && i.mime ? { mime: i.mime, data: new Uint8Array(i.data) } : undefined;
  }
}

export class InMemoryEventRoomRepository implements EventRoomRepository {
  private readonly postsRepo: InMemoryPostRepository;
  readonly going = new Map<string, { ref: EventRef; userId: string; createdAt: Date }>();
  readonly eventPosts = new Map<string, EventPostRecord>();

  constructor(postsRepo: InMemoryPostRepository) {
    this.postsRepo = postsRepo;
  }

  private static key(ref: EventRef): string {
    return `${ref.source}:${ref.id}`;
  }

  async addGoing(ref: EventRef, userId: string, at: Date): Promise<boolean> {
    const key = `${InMemoryEventRoomRepository.key(ref)}|${userId}`;
    if (this.going.has(key)) return false;
    this.going.set(key, { ref: { ...ref }, userId, createdAt: at });
    return true;
  }

  async removeGoing(ref: EventRef, userId: string): Promise<boolean> {
    return this.going.delete(`${InMemoryEventRoomRepository.key(ref)}|${userId}`);
  }

  /** Evento de pessoa apagado leva a presença e os posts junto (como o ON DELETE CASCADE do banco). */
  private alive(ref: EventRef): boolean {
    return ref.source === 'PLACE' || this.postsRepo.posts.has(ref.id);
  }

  async isGoing(ref: EventRef, userId: string): Promise<boolean> {
    return this.alive(ref) && this.going.has(`${InMemoryEventRoomRepository.key(ref)}|${userId}`);
  }

  async listGoing(ref: EventRef): Promise<EventAttendanceRecord[]> {
    const key = InMemoryEventRoomRepository.key(ref);
    if (!this.alive(ref)) return [];
    return [...this.going.values()]
      .filter((r) => InMemoryEventRoomRepository.key(r.ref) === key)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.userId < b.userId ? -1 : 1))
      .map((r) => ({ userId: r.userId, createdAt: r.createdAt }));
  }

  async countGoing(refs: EventRef[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const ref of refs) out.set(ref.id, 0);
    for (const r of this.going.values()) if (this.alive(r.ref) && out.has(r.ref.id) && refs.some((x) => x.source === r.ref.source && x.id === r.ref.id)) out.set(r.ref.id, (out.get(r.ref.id) ?? 0) + 1);
    return out;
  }

  async listGoingByUser(userId: string, limit: number): Promise<{ ref: EventRef; createdAt: Date }[]> {
    return [...this.going.values()]
      .filter((r) => r.userId === userId && this.alive(r.ref))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ref: { ...r.ref }, createdAt: r.createdAt }));
  }

  async addPost(post: EventPostRecord): Promise<void> {
    this.eventPosts.set(post.id, { ...post, data: post.data ? new Uint8Array(post.data) : null });
  }

  private static meta(p: EventPostRecord): Omit<EventPostRecord, 'data'> & { hasImage: boolean } {
    return { id: p.id, eventId: p.eventId, authorId: p.authorId, caption: p.caption, mime: p.mime, createdAt: p.createdAt, hasImage: p.data !== null };
  }

  async listPosts(eventId: string, page: Page): Promise<(Omit<EventPostRecord, 'data'> & { hasImage: boolean })[]> {
    return [...this.eventPosts.values()]
      .filter((p) => p.eventId === eventId && this.postsRepo.posts.has(eventId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(page.offset ?? 0, (page.offset ?? 0) + (page.limit ?? 50))
      .map(InMemoryEventRoomRepository.meta);
  }

  async findPost(id: string): Promise<(Omit<EventPostRecord, 'data'> & { hasImage: boolean }) | undefined> {
    const p = this.eventPosts.get(id);
    return p ? InMemoryEventRoomRepository.meta(p) : undefined;
  }

  async deletePost(id: string): Promise<void> {
    this.eventPosts.delete(id);
  }

  async findPostImage(id: string): Promise<{ mime: string; data: Uint8Array } | undefined> {
    const p = this.eventPosts.get(id);
    return p && p.mime && p.data ? { mime: p.mime, data: new Uint8Array(p.data) } : undefined;
  }

  async setPostsPublic(postId: string, ownerId: string, value: boolean): Promise<boolean> {
    const post = this.postsRepo.posts.get(postId);
    if (!post || post.authorId !== ownerId || post.eventTitle === null) return false;
    post.eventPostsPublic = value;
    return true;
  }
}

/** Gestão em memória: lê e age direto nos outros repositórios em memória. */
export class InMemoryAdminRepository implements AdminRepository {
  readonly audit = new Map<string, AuditRecord>();
  private readonly users: InMemoryUserRepository;
  private readonly posts: InMemoryPostRepository;
  private readonly conversations: InMemoryConversationRepository;
  private readonly places: InMemoryPlaceRepository;
  private readonly claims: InMemoryVenueClaimRepository;

  constructor(parts: { users: InMemoryUserRepository; posts: InMemoryPostRepository; conversations: InMemoryConversationRepository; places: InMemoryPlaceRepository; claims: InMemoryVenueClaimRepository }) {
    this.users = parts.users;
    this.posts = parts.posts;
    this.conversations = parts.conversations;
    this.places = parts.places;
    this.claims = parts.claims;
  }

  private username(id: string): string {
    return this.users.profiles.get(id)?.username ?? '(removido)';
  }

  private reportsAgainst(userId: string): number {
    let n = 0;
    for (const r of this.posts.reports.values()) if (this.posts.posts.get(r.postId)?.authorId === userId) n += 1;
    for (const r of this.conversations.reports.values()) if (r.reportedUserId === userId) n += 1;
    return n;
  }

  async stats() {
    const posts = [...this.posts.posts.values()];
    return {
      users: this.users.users.size,
      suspendedUsers: [...this.users.users.values()].filter((u) => u.status === 'SUSPENDED').length,
      venues: this.places.venues.size,
      venuesWithOwner: [...this.places.venues.values()].filter((v) => v.ownerId).length,
      placeEvents: this.places.events.size,
      userEvents: posts.filter((p) => p.eventTitle !== null).length,
      posts: posts.length,
      pendingClaims: [...this.claims.claims.values()].filter((c) => c.status === 'PENDING').length,
      approvedClaims: [...this.claims.claims.values()].filter((c) => c.status === 'APPROVED').length,
      openPostReports: [...this.posts.reports.values()].filter((r) => !r.resolvedAt).length,
      openConversationReports: [...this.conversations.reports.values()].filter((r) => !r.resolvedAt).length,
    };
  }

  async searchUsers(text: string, status: UserStatus | undefined, page: Page) {
    const q = fold(text.trim());
    const rows: AdminUserRow[] = [];
    for (const u of this.users.users.values()) {
      const p = this.users.profiles.get(u.id);
      if (!p) continue;
      if (status && u.status !== status) continue;
      if (q && !fold(`${u.email} ${p.username} ${p.displayName}`).includes(q)) continue;
      rows.push({ id: u.id, email: u.email, username: p.username, displayName: p.displayName, status: u.status, role: u.role, createdAt: u.createdAt, postsCount: [...this.posts.posts.values()].filter((x) => x.authorId === u.id).length, reportsCount: this.reportsAgainst(u.id) });
    }
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    return rows.slice(page.offset, page.offset + page.limit);
  }

  async setUserStatus(userId: string, status: UserStatus) {
    const u = this.users.users.get(userId);
    if (!u) return false;
    this.users.users.set(userId, { ...u, status });
    return true;
  }

  async searchVenues(text: string, page: Page) {
    const q = fold(text.trim());
    const rows: AdminVenueRow[] = [];
    for (const v of this.places.venues.values()) {
      if (q && !fold(`${v.name} ${v.address ?? ''}`).includes(q)) continue;
      rows.push({ id: v.id, name: v.name, address: v.address, category: v.category, isSample: v.isSample, owner: v.ownerId ? { id: v.ownerId, username: this.username(v.ownerId) } : null, eventsCount: [...this.places.events.values()].filter((e) => e.venueId === v.id).length });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
    return rows.slice(page.offset, page.offset + page.limit);
  }

  async searchPlaceEvents(text: string, page: Page) {
    const q = fold(text.trim());
    const rows: AdminPlaceEventRow[] = [];
    for (const e of this.places.events.values()) {
      const v = this.places.venues.get(e.venueId);
      if (!v) continue;
      if (q && !fold(`${e.title} ${v.name}`).includes(q)) continue;
      rows.push({ id: e.id, title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, kind: e.kind, isSample: e.isSample, venue: { id: v.id, name: v.name } });
    }
    rows.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || (a.id < b.id ? -1 : 1));
    return rows.slice(page.offset, page.offset + page.limit);
  }

  async deletePlaceEvent(id: string) {
    this.places.covers.delete(id);
    return this.places.events.delete(id);
  }

  private postRow(p: PostRecord): AdminPostRow {
    const images = [...this.posts.images.values()].filter((i) => i.postId === p.id).sort((a, b) => a.position - b.position);
    return {
      id: p.id, caption: p.caption, author: { id: p.authorId, username: this.username(p.authorId) }, imagesCount: images.length,
      firstImageId: images.find((i) => i.data !== null)?.id ?? null, eventTitle: p.eventTitle, eventStartsAt: p.eventStartsAt, archived: p.archivedAt !== null,
      reportsCount: [...this.posts.reports.values()].filter((r) => r.postId === p.id).length, createdAt: p.createdAt,
    };
  }

  async searchPosts(text: string, onlyEvents: boolean, page: Page) {
    const q = fold(text.trim());
    const rows: AdminPostRow[] = [];
    for (const p of this.posts.posts.values()) {
      if (onlyEvents && p.eventTitle === null) continue;
      if (q && !fold(`${p.caption ?? ''} ${p.eventTitle ?? ''} ${p.placeName ?? ''} ${this.username(p.authorId)}`).includes(q)) continue;
      rows.push(this.postRow(p));
    }
    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1));
    return rows.slice(page.offset, page.offset + page.limit);
  }

  async findPostRow(id: string) {
    const p = this.posts.posts.get(id);
    return p ? this.postRow(p) : undefined;
  }

  async deletePost(id: string) {
    const p = this.posts.posts.get(id);
    return p ? this.posts.delete(id, p.authorId) : false;
  }

  async listPostReports(open: boolean, page: Page) {
    const rows: AdminPostReportRow[] = [];
    for (const r of this.posts.reports.values()) {
      if (open === (r.resolvedAt !== null && r.resolvedAt !== undefined)) continue;
      const p = this.posts.posts.get(r.postId);
      if (!p) continue;
      rows.push({ id: r.id, reason: r.reason, details: r.details, createdAt: r.createdAt, reporter: { id: r.reporterId, username: this.username(r.reporterId) }, post: this.postRow(p), resolvedAt: r.resolvedAt ?? null, resolution: r.resolution ?? null, resolutionNote: r.resolutionNote ?? null });
    }
    rows.sort((a, b) => (open ? a.createdAt.getTime() - b.createdAt.getTime() : (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0)) || (a.id < b.id ? -1 : 1));
    return rows.slice(page.offset, page.offset + page.limit);
  }

  async listConversationReports(open: boolean, page: Page) {
    const rows: AdminConversationReportRow[] = [];
    for (const r of this.conversations.reports.values()) {
      if (open === (r.resolvedAt !== null && r.resolvedAt !== undefined)) continue;
      const reported = r.reportedUserId ? this.users.users.get(r.reportedUserId) : undefined;
      rows.push({
        id: r.id, conversationId: r.conversationId, reason: r.reason, details: r.details, evidence: r.evidence, createdAt: r.createdAt,
        reporter: { id: r.reporterId, username: this.username(r.reporterId) },
        reported: r.reportedUserId && reported ? { id: r.reportedUserId, username: this.username(r.reportedUserId), status: reported.status } : null,
        resolvedAt: r.resolvedAt ?? null, resolution: r.resolution ?? null, resolutionNote: r.resolutionNote ?? null,
      });
    }
    rows.sort((a, b) => (open ? a.createdAt.getTime() - b.createdAt.getTime() : (b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0)) || (a.id < b.id ? -1 : 1));
    return rows.slice(page.offset, page.offset + page.limit);
  }

  async findPostReport(id: string) {
    for (const r of this.posts.reports.values()) if (r.id === id) return { id: r.id, postId: r.postId, resolvedAt: r.resolvedAt ?? null };
    return undefined;
  }

  async findConversationReport(id: string) {
    for (const r of this.conversations.reports.values()) if (r.id === id) return { id: r.id, reportedUserId: r.reportedUserId, resolvedAt: r.resolvedAt ?? null };
    return undefined;
  }

  async resolvePostReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date) {
    for (const [key, r] of this.posts.reports) {
      if (r.id !== id) continue;
      if (r.resolvedAt) return false;
      this.posts.reports.set(key, { ...r, resolvedAt: at, resolvedBy: adminId, resolution, resolutionNote: note });
      return true;
    }
    return false;
  }

  async resolveConversationReport(id: string, adminId: string, resolution: ReportResolution, note: string | null, at: Date) {
    for (const [key, r] of this.conversations.reports) {
      if (r.id !== id) continue;
      if (r.resolvedAt) return false;
      this.conversations.reports.set(key, { ...r, resolvedAt: at, resolvedBy: adminId, resolution, resolutionNote: note });
      return true;
    }
    return false;
  }

  async addAudit(record: AuditRecord) {
    this.audit.set(record.id, { ...record });
  }

  async listAudit(page: Page) {
    return [...this.audit.values()]
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.createdAt.getTime() - a.r.createdAt.getTime() || b.i - a.i)
      .map((x) => x.r)
      .slice(page.offset, page.offset + page.limit)
      .map((r) => ({ ...r, adminUsername: this.username(r.adminId) }));
  }
}

export class InMemorySchedulingRepository implements SchedulingRepository {
  private readonly polls = new Map<string, PollRecord>();
  private readonly participants = new Map<string, Map<string, Date | null>>();
  private readonly votes = new Map<string, Map<string, PollVoteRecord>>(); // pollId -> "user|date"
  private readonly proposals = new Map<string, PollProposalRecord>();
  private readonly confirmations = new Map<string, Map<string, PollConfirmationRecord>>();

  async create(poll: PollRecord, participantIds: string[], at: Date): Promise<void> {
    void at;
    this.polls.set(poll.id, { ...poll });
    this.participants.set(poll.id, new Map(participantIds.map((id) => [id, null] as const)));
    this.votes.set(poll.id, new Map());
  }

  async find(id: string): Promise<PollRecord | undefined> {
    const p = this.polls.get(id);
    return p ? { ...p } : undefined;
  }

  async findByEventPost(postId: string): Promise<PollRecord | undefined> {
    const p = [...this.polls.values()].find((x) => x.eventPostId === postId);
    return p ? { ...p } : undefined;
  }

  async listForConversation(conversationId: string): Promise<PollRecord[]> {
    return [...this.polls.values()]
      .filter((p) => p.conversationId === conversationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((p) => ({ ...p }));
  }

  async listDeadlinePassed(now: Date, limit: number): Promise<PollRecord[]> {
    return [...this.polls.values()]
      .filter((p) => p.status === 'VOTING' && p.votingDeadline !== null && p.votingDeadline <= now && !p.votingClosedAt && !p.deadlineNotifiedAt)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }

  async listOpenForUser(userId: string, limit: number): Promise<PollRecord[]> {
    return [...this.polls.values()]
      .filter((p) => (p.status === 'VOTING' || p.status === 'CONFIRMING') && this.participants.get(p.id)?.has(userId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((p) => ({ ...p }));
  }

  async listParticipants(pollId: string): Promise<PollParticipantRecord[]> {
    return [...(this.participants.get(pollId) ?? new Map<string, Date | null>()).entries()].map(([userId, finishedAt]) => ({ userId, finishedAt })).sort((a, b) => (a.userId < b.userId ? -1 : 1));
  }

  async listVotes(pollId: string): Promise<PollVoteRecord[]> {
    return [...(this.votes.get(pollId)?.values() ?? [])].map((v) => ({ ...v })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.userId < b.userId ? -1 : 1));
  }

  async setVotes(pollId: string, userId: string, dates: string[], status: 'YES' | 'MAYBE' | 'NO' | null, at: Date): Promise<void> {
    void at;
    const m = this.votes.get(pollId);
    if (!m) return;
    for (const date of dates) {
      if (status === null) m.delete(`${userId}|${date}`);
      else m.set(`${userId}|${date}`, { userId, date, status });
    }
  }

  async setFinished(pollId: string, userId: string, at: Date | null): Promise<void> {
    const m = this.participants.get(pollId);
    if (m?.has(userId)) m.set(userId, at);
  }

  async updatePoll(pollId: string, patch: { status?: PollStatus; title?: string; finalProposalId?: string | null; meetupId?: string | null; votingClosedAt?: Date | null; eventPostId?: string | null; deadlineNotifiedAt?: Date | null }): Promise<void> {
    const p = this.polls.get(pollId);
    if (p) this.polls.set(pollId, { ...p, ...patch });
  }

  async createProposal(proposal: PollProposalRecord): Promise<void> {
    if (proposal.status === 'OPEN' && [...this.proposals.values()].some((p) => p.pollId === proposal.pollId && p.status === 'OPEN')) throw conflict('Já existe uma proposta aberta');
    this.proposals.set(proposal.id, { ...proposal });
    this.confirmations.set(proposal.id, new Map());
  }

  async findProposal(id: string): Promise<PollProposalRecord | undefined> {
    const p = this.proposals.get(id);
    return p ? { ...p } : undefined;
  }

  async listProposals(pollId: string): Promise<PollProposalRecord[]> {
    return [...this.proposals.values()]
      .filter((p) => p.pollId === pollId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : 1))
      .map((p) => ({ ...p }));
  }

  async updateProposal(id: string, patch: { status: PollProposalStatus }): Promise<void> {
    const p = this.proposals.get(id);
    if (p) this.proposals.set(id, { ...p, ...patch });
  }

  async setConfirmation(proposalId: string, pollId: string, userId: string, status: 'CONFIRMED' | 'ADJUST' | 'DECLINED', at: Date): Promise<void> {
    void pollId;
    this.confirmations.get(proposalId)?.set(userId, { userId, status, respondedAt: at });
  }

  async listConfirmations(proposalId: string): Promise<PollConfirmationRecord[]> {
    return [...(this.confirmations.get(proposalId)?.values() ?? [])].map((c) => ({ ...c })).sort((a, b) => (a.userId < b.userId ? -1 : 1));
  }
}
