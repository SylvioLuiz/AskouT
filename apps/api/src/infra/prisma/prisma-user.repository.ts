import type { PrismaClient } from '@prisma/client';
import { conflict } from '../../core/errors.ts';
import type { UserRepository } from '../../core/ports.ts';
import type { Profile, ProfilePhotoRecord, User } from '../../core/types.ts';
import { isUuid, onlyUuids, uniqueViolationTargets } from './helpers.ts';

function toUser(row: {
  id: string;
  email: string;
  passwordHash: string;
  status: User['status'];
  role: User['role'];
  createdAt: Date;
  birthDate: Date | null;
  termsAcceptedAt: Date | null;
  termsVersion: string | null;
}): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status,
    role: row.role,
    createdAt: row.createdAt,
    birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    termsAcceptedAt: row.termsAcceptedAt,
    termsVersion: row.termsVersion,
  };
}

function toProfile(row: {
  userId: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  isPrivate: boolean;
}): Profile {
  return {
    userId: row.userId,
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    avatarUrl: row.avatarUrl,
    isPrivate: row.isPrivate,
  };
}

export class PrismaUserRepository implements UserRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(user: User, profile: Profile): Promise<void> {
    try {
      // Criação aninhada: usuário, perfil e configurações entram na mesma transação.
      await this.prisma.user.create({
        data: {
          id: user.id,
          email: user.email,
          passwordHash: user.passwordHash,
          status: user.status,
          role: user.role,
          createdAt: user.createdAt,
          birthDate: user.birthDate ? new Date(`${user.birthDate}T00:00:00.000Z`) : null,
          termsAcceptedAt: user.termsAcceptedAt ?? null,
          termsVersion: user.termsVersion ?? null,
          profile: {
            create: {
              username: profile.username,
              displayName: profile.displayName,
              bio: profile.bio,
              avatarUrl: profile.avatarUrl,
              isPrivate: profile.isPrivate,
            },
          },
          settings: { create: {} },
        },
      });
    } catch (error) {
      const targets = uniqueViolationTargets(error);
      if (targets) {
        if (targets.some((t) => t.includes('email'))) {
          throw conflict('Este e-mail já está em uso', { email: 'Este e-mail já está em uso' });
        }
        if (targets.some((t) => t.includes('username'))) {
          throw conflict('Este nome de usuário já está em uso', { username: 'Este nome de usuário já está em uso' });
        }
      }
      throw error;
    }
  }

  async findById(id: string): Promise<User | undefined> {
    if (!isUuid(id)) return undefined;
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? toUser(row) : undefined;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const row = await this.prisma.user.findUnique({ where: { email } });
    return row ? toUser(row) : undefined;
  }

  async findIdsByEmailHashes(hashes: string[]): Promise<string[]> {
    if (hashes.length === 0) return [];
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM "User"
      WHERE status <> 'SUSPENDED' AND encode(sha256(convert_to(lower(email), 'UTF8')), 'hex') = ANY(${hashes}::text[])`;
    return rows.map((r) => r.id);
  }

  async findProfileById(userId: string): Promise<Profile | undefined> {
    if (!isUuid(userId)) return undefined;
    const row = await this.prisma.profile.findUnique({ where: { userId } });
    return row ? toProfile(row) : undefined;
  }

  async findProfileByUsername(username: string): Promise<Profile | undefined> {
    const row = await this.prisma.profile.findUnique({ where: { username } });
    return row ? toProfile(row) : undefined;
  }

  async findProfilesByIds(ids: string[]): Promise<Profile[]> {
    const valid = onlyUuids(ids);
    if (valid.length === 0) return [];
    const rows = await this.prisma.profile.findMany({
      where: { userId: { in: valid }, user: { status: { not: 'SUSPENDED' } } },
    });
    const byId = new Map((rows as Parameters<typeof toProfile>[0][]).map((r) => [r.userId, toProfile(r)] as const));
    const ordered: Profile[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      if (p) ordered.push(p);
    }
    return ordered;
  }

  async setPhoto(userId: string, photo: ProfilePhotoRecord | null): Promise<void> {
    if (!isUuid(userId)) return;
    if (photo === null) {
      await this.prisma.profilePhoto.deleteMany({ where: { userId } });
      return;
    }
    const data = Buffer.from(photo.data);
    await this.prisma.profilePhoto.upsert({
      where: { userId },
      create: { userId, mime: photo.mime, data, updatedAt: photo.updatedAt },
      update: { mime: photo.mime, data, updatedAt: photo.updatedAt },
    });
  }

  async findPhoto(userId: string): Promise<ProfilePhotoRecord | undefined> {
    if (!isUuid(userId)) return undefined;
    const row = await this.prisma.profilePhoto.findUnique({ where: { userId } });
    return row ? { mime: row.mime as ProfilePhotoRecord['mime'], data: new Uint8Array(row.data), updatedAt: row.updatedAt } : undefined;
  }

  async setBirthDate(userId: string, birthDate: string): Promise<boolean> {
    if (!isUuid(userId)) return false;
    const r = await this.prisma.user.updateMany({ where: { id: userId, birthDate: null }, data: { birthDate: new Date(`${birthDate}T00:00:00.000Z`) } });
    return r.count === 1;
  }

  async updateBirthDate(userId: string, birthDate: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.user.updateMany({ where: { id: userId }, data: { birthDate: new Date(`${birthDate}T00:00:00.000Z`) } });
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    if (!isUuid(userId)) return;
    await this.prisma.user.updateMany({ where: { id: userId }, data: { passwordHash } });
  }

  async updateProfile(profile: Profile): Promise<void> {
    await this.prisma.profile.update({
      where: { userId: profile.userId },
      data: {
        displayName: profile.displayName,
        bio: profile.bio,
        avatarUrl: profile.avatarUrl,
        isPrivate: profile.isPrivate,
      },
    });
  }

  async searchProfiles(query: string, limit: number, excludeIds: string[]): Promise<Profile[]> {
    const q = query.toLowerCase();
    const rows = await this.prisma.profile.findMany({
      where: {
        userId: { notIn: onlyUuids(excludeIds) },
        user: { status: { not: 'SUSPENDED' } },
        OR: [{ username: { startsWith: q } }, { displayName: { contains: q, mode: 'insensitive' } }],
      },
      orderBy: { username: 'asc' },
      take: limit,
    });
    return (rows as Parameters<typeof toProfile>[0][]).map(toProfile);
  }
}
