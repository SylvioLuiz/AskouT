import { notFound, validationError } from './errors.ts';
import { evaluateFriendship } from './friendship.ts';
import type { CoreDeps } from './ports.ts';
import type { FollowStatus, Profile, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';
import {
  asString,
  assertNoProblems,
  avatarUrlProblem,
  bioProblem,
  displayNameProblem,
  normalizeBio,
  normalizeDisplayName,
  normalizeUsername,
} from './validation.ts';

export type RelationState = 'NONE' | FollowStatus;

export interface ProfileView {
  profile: Profile;
  counts: { followers: number; following: number };
  relationship: {
    isSelf: boolean;
    /** O visitante segue este perfil? */
    following: RelationState;
    /** Este perfil segue o visitante? PENDING = pediu para seguir e aguarda aprovação do visitante. */
    followsYou: RelationState;
    isFriend: boolean;
    blockedByViewer: boolean;
  };
  /** Fonte única para liberar conteúdo (publicações etc.): perfil público, próprio ou seguidor aprovado. */
  canViewContent: boolean;
}

export interface ProfilePatch {
  displayName?: unknown;
  bio?: unknown;
  avatarUrl?: unknown;
}

export const SEARCH_MIN_LENGTH = 2;
export const SEARCH_MAX_LIMIT = 50;

export class ProfileService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async getByUsername(viewerId: string, rawUsername: unknown): Promise<ProfileView> {
    const { users, follows, blocks } = this.deps;
    const profile = await users.findProfileByUsername(normalizeUsername(asString(rawUsername)));
    const target = profile ? await users.findById(profile.userId) : undefined;
    if (!profile || !target || target.status === 'SUSPENDED') throw notFound('Usuário não encontrado');

    const [followers, following] = await Promise.all([
      follows.count(profile.userId, 'followers', 'ACCEPTED'),
      follows.count(profile.userId, 'following', 'ACCEPTED'),
    ]);
    const counts = { followers, following };

    if (viewerId === profile.userId) {
      return {
        profile,
        counts,
        relationship: { isSelf: true, following: 'NONE', followsYou: 'NONE', isFriend: false, blockedByViewer: false },
        canViewContent: true,
      };
    }

    // Quem bloqueou o visitante some para ele.
    if (await blocks.exists(profile.userId, viewerId)) throw notFound('Usuário não encontrado');

    const [viewerFollows, targetFollows, blockedByViewer] = await Promise.all([
      follows.get(viewerId, profile.userId),
      follows.get(profile.userId, viewerId),
      blocks.exists(viewerId, profile.userId),
    ]);

    return {
      profile,
      counts,
      relationship: {
        isSelf: false,
        following: viewerFollows?.status ?? 'NONE',
        followsYou: targetFollows?.status ?? 'NONE',
        isFriend: evaluateFriendship(viewerFollows, targetFollows, blockedByViewer),
        blockedByViewer,
      },
      canViewContent: !blockedByViewer && (!profile.isPrivate || viewerFollows?.status === 'ACCEPTED'),
    };
  }

  async updateOwn(userId: string, patch: ProfilePatch): Promise<Profile> {
    const { users } = this.deps;
    const current = await users.findProfileById(userId);
    if (!current) throw notFound('Perfil não encontrado');

    const next: Profile = { ...current };
    const problems: Record<string, string | undefined> = {};

    if (patch.displayName !== undefined) {
      if (typeof patch.displayName !== 'string') {
        problems.displayName = 'Informe um nome';
      } else {
        next.displayName = normalizeDisplayName(patch.displayName);
        problems.displayName = displayNameProblem(next.displayName);
      }
    }
    if (patch.bio !== undefined) {
      if (patch.bio !== null && typeof patch.bio !== 'string') {
        problems.bio = 'Biografia inválida';
      } else {
        next.bio = normalizeBio(patch.bio);
        problems.bio = bioProblem(next.bio);
      }
    }
    if (patch.avatarUrl !== undefined) {
      if (patch.avatarUrl !== null && typeof patch.avatarUrl !== 'string') {
        problems.avatarUrl = 'URL da foto inválida';
      } else {
        next.avatarUrl = patch.avatarUrl === null ? null : patch.avatarUrl.trim() || null;
        problems.avatarUrl = avatarUrlProblem(next.avatarUrl);
      }
    }

    assertNoProblems(problems);
    await users.updateProfile(next);
    return next;
  }

  /**
   * Ao tornar o perfil público, as solicitações pendentes são aceitas automaticamente
   * (comportamento padrão de redes sociais). Ao tornar privado, seguidores atuais permanecem.
   */
  async setPrivacy(userId: string, isPrivate: unknown): Promise<{ isPrivate: boolean; acceptedPending: number }> {
    if (typeof isPrivate !== 'boolean') throw validationError('Valor inválido', { isPrivate: 'Use true ou false' });
    const { users, follows } = this.deps;
    const current = await users.findProfileById(userId);
    if (!current) throw notFound('Perfil não encontrado');

    if (current.isPrivate === isPrivate) return { isPrivate, acceptedPending: 0 };

    await users.updateProfile({ ...current, isPrivate });
    const acceptedPending = isPrivate ? 0 : await follows.acceptAllPending(userId);
    return { isPrivate, acceptedPending };
  }

  /** Busca por username (prefixo) ou nome. Não retorna o próprio usuário nem bloqueios em qualquer sentido. */
  async search(viewerId: string, rawQuery: unknown, limit = 20): Promise<PublicProfile[]> {
    const query = normalizeUsername(asString(rawQuery));
    if (query.length < SEARCH_MIN_LENGTH) {
      throw validationError('Busca muito curta', { query: `Digite ao menos ${SEARCH_MIN_LENGTH} caracteres` });
    }
    const cappedLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), SEARCH_MAX_LIMIT);
    const related = await this.deps.blocks.listRelatedIds(viewerId);
    const found = await this.deps.users.searchProfiles(query, cappedLimit, [viewerId, ...related]);
    return found.map(toPublicProfile);
  }
}
