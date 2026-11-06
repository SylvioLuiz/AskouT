import { validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ActivityAction, ActivityKind, ActivityRecord, ActivityTarget, Profile, PublicProfile } from './types.ts';
import { ACTIVITY_KINDS, toPublicProfile } from './types.ts';

export const ACTIVITY_PAGE_DEFAULT = 20;
export const ACTIVITY_PAGE_MAX = 50;

/** Quais ações entram em cada chip. */
export const ACTIVITY_ACTIONS: Record<ActivityKind, readonly ActivityAction[]> = {
  LIKE: ['POST_LIKE', 'FEED_REACTION'],
  COMMENT: ['POST_COMMENT', 'FEED_COMMENT'],
  POST: ['POST_CREATED', 'FEED_POST'],
  FOLLOW: ['FOLLOW_USER', 'FOLLOW_VENUE'],
  EVENT: ['EVENT_CREATED', 'EVENT_GOING'],
};

const KIND_OF: Record<ActivityAction, ActivityKind> = Object.fromEntries(
  Object.entries(ACTIVITY_ACTIONS).flatMap(([kind, actions]) => actions.map((a) => [a, kind])),
) as Record<ActivityAction, ActivityKind>;

const ALL_ACTIONS = Object.values(ACTIVITY_ACTIONS).flat();

export interface ActivityItemView {
  id: string;
  kind: ActivityKind;
  action: ActivityAction;
  at: string;
  /** false: o conteúdo não está mais disponível (conta bloqueada, suspensa ou post arquivado). Sem link nem dados de quem é. */
  available: boolean;
  target: ActivityTarget | null;
  /** Dono do conteúdo (autor do post, pessoa seguida), quando não é a própria pessoa. */
  person: PublicProfile | null;
  title: string | null;
  text: string | null;
  pending: boolean;
}

export interface ActivityPage {
  items: ActivityItemView[];
  /** Para pedir a próxima página; null quando acabou. */
  nextCursor: string | null;
}

function encodeCursor(r: { at: Date; id: string }): string {
  return Buffer.from(`${r.at.getTime()}:${r.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  const sep = text.indexOf(':');
  const ms = Number(text.slice(0, sep));
  const id = text.slice(sep + 1);
  if (sep <= 0 || !Number.isSafeInteger(ms) || id.length === 0 || id.length > 200) throw validationError('Página inválida');
  return { at: new Date(ms), id };
}

export class ActivityService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** O registro de atividades da própria pessoa. Só ela vê. */
  async list(actorId: string, input: { kind?: string; cursor?: string; limit?: number } = {}): Promise<ActivityPage> {
    const kind = input.kind?.trim().toUpperCase() || undefined;
    if (kind !== undefined && kind !== 'ALL' && !(ACTIVITY_KINDS as readonly string[]).includes(kind)) throw validationError('Filtro inválido');
    const actions = kind === undefined || kind === 'ALL' ? ALL_ACTIONS : ACTIVITY_ACTIONS[kind as ActivityKind];
    const limit = Math.min(Math.max(Math.trunc(input.limit ?? ACTIVITY_PAGE_DEFAULT) || ACTIVITY_PAGE_DEFAULT, 1), ACTIVITY_PAGE_MAX);
    const before = input.cursor ? decodeCursor(input.cursor) : undefined;

    const rows = await this.deps.activity.listByUser(actorId, { actions, limit: limit + 1, ...(before ? { before } : {}) });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor(last) : null;

    const ownerIds = [...new Set(page.map((r) => r.ownerId).filter((id): id is string => id !== null && id !== actorId))];
    const [profiles, related] = await Promise.all([
      ownerIds.length > 0 ? this.deps.users.findProfilesByIds(ownerIds) : Promise.resolve([]),
      ownerIds.length > 0 ? this.deps.blocks.listRelatedIds(actorId) : Promise.resolve([] as string[]),
    ]);
    const byId = new Map(profiles.map((p) => [p.userId, p]));
    const blocked = new Set(related);

    return { items: page.map((r) => this.view(actorId, r, byId, blocked)), nextCursor };
  }

  private view(actorId: string, r: ActivityRecord, profiles: Map<string, Profile>, blocked: Set<string>): ActivityItemView {
    const own = r.ownerId === null || r.ownerId === actorId;
    const profile = !own && r.ownerId ? profiles.get(r.ownerId) : undefined;
    // Conta bloqueada (qualquer sentido), suspensa ou apagada: o item fica, mas sem dizer de quem nem levar a lugar nenhum.
    const available = !r.hidden && (own || (profile !== undefined && !blocked.has(r.ownerId as string)));
    const base = { id: r.id, kind: KIND_OF[r.action], action: r.action, at: r.at.toISOString(), pending: r.pending };
    if (!available) {
      // O que a própria pessoa escreveu continua visível; o conteúdo dos outros, não.
      const ownText = r.action === 'POST_COMMENT' || r.action === 'FEED_COMMENT' || r.action === 'FEED_POST' || r.action === 'FEED_REACTION';
      return { ...base, available: false, target: null, person: null, title: null, text: ownText ? r.text : null };
    }
    return { ...base, available: true, target: r.target, person: profile ? toPublicProfile(profile) : null, title: r.title, text: r.text };
  }
}
