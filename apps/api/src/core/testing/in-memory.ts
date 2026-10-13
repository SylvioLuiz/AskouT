import { conflict } from '../errors.ts';
import { evaluateFriendship } from '../friendship.ts';
import type {
  AvailabilityRepository,
  FlashRepository,
  BlockRepository,
  Clock,
  EmailSender,
  FollowRepository,
  IdGenerator,
  PendingSignupRepository,
  UserRepository,
} from '../ports.ts';
import type { AvailabilitySlotRecord, Direction, FlashInviteRecord, FlashPositionRecord, FlashSessionRecord, Follow, FollowStatus, Page, PendingSignup, Profile, User } from '../types.ts';

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

  async findById(id: string): Promise<User | undefined> {
    const u = this.users.get(id);
    return u ? { ...u } : undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    for (const u of this.users.values()) if (u.email === email) return { ...u };
    return undefined;
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
