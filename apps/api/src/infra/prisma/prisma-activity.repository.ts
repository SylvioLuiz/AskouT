import type { PrismaClient } from '@prisma/client';
import type { ActivityRepository } from '../../core/ports.ts';
import type { ActivityAction, ActivityRecord, ActivityTarget } from '../../core/types.ts';
import { isUuid } from './helpers.ts';

type PostInfo = { id: string; authorId: string; caption: string | null; eventTitle: string | null; archivedAt: Date | null };
type FeedPlace = { placeEvent: { id: string; title: string } | null; userEvent: { id: string; eventTitle: string | null } | null; venue: { id: string; name: string } | null };

const postSelect = { id: true, authorId: true, caption: true, eventTitle: true, archivedAt: true } as const;
const feedPlaceSelect = {
  placeEvent: { select: { id: true, title: true } },
  userEvent: { select: { id: true, eventTitle: true } },
  venue: { select: { id: true, name: true } },
} as const;

function postTarget(p: PostInfo): { target: ActivityTarget; ownerId: string; title: string | null; hidden: boolean } {
  return { target: { type: p.eventTitle ? 'USER_EVENT' : 'POST', id: p.id }, ownerId: p.authorId, title: p.eventTitle ?? (p.caption ? p.caption.slice(0, 120) : null), hidden: p.archivedAt !== null };
}

/** Onde fica o feed (evento ou local). undefined se o alvo não existe mais. */
function feedPlace(f: FeedPlace): { target: ActivityTarget; title: string | null } | undefined {
  if (f.placeEvent) return { target: { type: 'PLACE_EVENT', id: f.placeEvent.id }, title: f.placeEvent.title };
  if (f.userEvent) return { target: { type: 'USER_EVENT', id: f.userEvent.id }, title: f.userEvent.eventTitle };
  if (f.venue) return { target: { type: 'VENUE', id: f.venue.id }, title: f.venue.name };
  return undefined;
}

/**
 * Junta as tabelas de cada tipo de atividade. Cada uma traz até `limit` + folga linhas a partir do cursor,
 * já em ordem; o resultado é intercalado e cortado aqui (as tabelas não têm um id comum para paginar no banco).
 */
export class PrismaActivityRepository implements ActivityRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async listByUser(userId: string, query: { actions: readonly ActivityAction[]; before?: { at: Date; id: string }; limit: number }): Promise<ActivityRecord[]> {
    if (!isUuid(userId)) return [];
    const want = new Set(query.actions);
    const take = query.limit + 20;
    const createdAt = query.before ? { lte: query.before.at } : undefined;
    const order = { createdAt: 'desc' } as const;
    const out: ActivityRecord[] = [];
    const push = (r: Omit<ActivityRecord, 'hidden' | 'pending'> & { hidden?: boolean; pending?: boolean }) => out.push({ hidden: false, pending: false, ...r });
    const tasks: Promise<void>[] = [];

    if (want.has('POST_LIKE')) {
      tasks.push(
        this.prisma.postLike.findMany({ where: { userId, ...(createdAt ? { createdAt } : {}) }, orderBy: order, take, select: { createdAt: true, post: { select: postSelect } } }).then((rows) => {
          for (const r of rows) push({ id: `like:${r.post.id}`, action: 'POST_LIKE', at: r.createdAt, ...postTarget(r.post), text: null });
        }),
      );
    }
    if (want.has('POST_COMMENT')) {
      tasks.push(
        this.prisma.postComment.findMany({ where: { authorId: userId, ...(createdAt ? { createdAt } : {}) }, orderBy: order, take, select: { id: true, body: true, createdAt: true, post: { select: postSelect } } }).then((rows) => {
          for (const r of rows) push({ id: `comment:${r.id}`, action: 'POST_COMMENT', at: r.createdAt, ...postTarget(r.post), text: r.body });
        }),
      );
    }
    if (want.has('POST_CREATED') || want.has('EVENT_CREATED')) {
      const onlyEvents = !want.has('POST_CREATED');
      const onlyPosts = !want.has('EVENT_CREATED');
      tasks.push(
        this.prisma.post
          .findMany({
            where: { authorId: userId, ...(createdAt ? { createdAt } : {}), ...(onlyEvents ? { eventTitle: { not: null } } : onlyPosts ? { eventTitle: null } : {}) },
            orderBy: order,
            take,
            select: { ...postSelect, createdAt: true },
          })
          .then((rows) => {
            for (const p of rows) push({ id: `post:${p.id}`, action: p.eventTitle ? 'EVENT_CREATED' : 'POST_CREATED', at: p.createdAt, target: { type: p.eventTitle ? 'USER_EVENT' : 'POST', id: p.id }, ownerId: userId, title: p.eventTitle, text: p.caption ? p.caption.slice(0, 280) : null });
          }),
      );
    }
    if (want.has('FEED_POST')) {
      tasks.push(
        this.prisma.feedPost.findMany({ where: { authorId: userId, ...(createdAt ? { createdAt } : {}) }, orderBy: order, take, select: { id: true, body: true, status: true, createdAt: true, ...feedPlaceSelect } }).then((rows) => {
          for (const f of rows) {
            const place = feedPlace(f);
            if (place) push({ id: `feedpost:${f.id}`, action: 'FEED_POST', at: f.createdAt, target: place.target, ownerId: userId, title: place.title, text: f.body ? f.body.slice(0, 280) : null, pending: f.status === 'PENDING' });
          }
        }),
      );
    }
    if (want.has('FEED_REACTION')) {
      tasks.push(
        this.prisma.feedReaction.findMany({ where: { userId, ...(createdAt ? { createdAt } : {}) }, orderBy: order, take, select: { emoji: true, createdAt: true, post: { select: { id: true, authorId: true, ...feedPlaceSelect } } } }).then((rows) => {
          for (const r of rows) {
            const place = feedPlace(r.post);
            if (place) push({ id: `reaction:${r.post.id}`, action: 'FEED_REACTION', at: r.createdAt, target: place.target, ownerId: r.post.authorId, title: place.title, text: r.emoji });
          }
        }),
      );
    }
    if (want.has('FEED_COMMENT')) {
      tasks.push(
        this.prisma.feedComment.findMany({ where: { authorId: userId, ...(createdAt ? { createdAt } : {}) }, orderBy: order, take, select: { id: true, body: true, createdAt: true, post: { select: { authorId: true, ...feedPlaceSelect } } } }).then((rows) => {
          for (const c of rows) {
            const place = feedPlace(c.post);
            if (place) push({ id: `feedcomment:${c.id}`, action: 'FEED_COMMENT', at: c.createdAt, target: place.target, ownerId: c.post.authorId, title: place.title, text: c.body });
          }
        }),
      );
    }
    if (want.has('EVENT_GOING')) {
      tasks.push(
        this.prisma.eventAttendance
          .findMany({
            where: { userId, ...(createdAt ? { createdAt } : {}) },
            orderBy: order,
            take,
            select: { createdAt: true, placeEvent: { select: { id: true, title: true } }, post: { select: { id: true, authorId: true, eventTitle: true, archivedAt: true } } },
          })
          .then((rows) => {
            for (const g of rows) {
              if (g.placeEvent) push({ id: `going:${g.placeEvent.id}`, action: 'EVENT_GOING', at: g.createdAt, target: { type: 'PLACE_EVENT', id: g.placeEvent.id }, ownerId: null, title: g.placeEvent.title, text: null });
              else if (g.post) push({ id: `going:${g.post.id}`, action: 'EVENT_GOING', at: g.createdAt, target: { type: 'USER_EVENT', id: g.post.id }, ownerId: g.post.authorId, title: g.post.eventTitle, text: null, hidden: g.post.archivedAt !== null });
            }
          }),
      );
    }
    if (want.has('FOLLOW_USER')) {
      tasks.push(
        this.prisma.follow.findMany({ where: { followerId: userId, ...(createdAt ? { createdAt } : {}) }, orderBy: order, take, select: { followeeId: true, status: true, createdAt: true } }).then((rows) => {
          for (const f of rows) push({ id: `follow:${f.followeeId}`, action: 'FOLLOW_USER', at: f.createdAt, target: { type: 'USER', id: f.followeeId }, ownerId: f.followeeId, title: null, text: null, pending: f.status === 'PENDING' });
        }),
      );
    }
    if (want.has('FOLLOW_VENUE')) {
      tasks.push(
        this.prisma.venueFollow.findMany({ where: { userId, ...(createdAt ? { createdAt } : {}) }, orderBy: order, take, select: { createdAt: true, venue: { select: { id: true, name: true } } } }).then((rows) => {
          for (const v of rows) push({ id: `venue:${v.venue.id}`, action: 'FOLLOW_VENUE', at: v.createdAt, target: { type: 'VENUE', id: v.venue.id }, ownerId: null, title: v.venue.name, text: null });
        }),
      );
    }

    await Promise.all(tasks);
    const b = query.before;
    return out
      .filter((r) => !b || r.at.getTime() < b.at.getTime() || (r.at.getTime() === b.at.getTime() && r.id < b.id))
      .sort((x, y) => y.at.getTime() - x.at.getTime() || (x.id < y.id ? 1 : x.id > y.id ? -1 : 0))
      .slice(0, query.limit);
  }
}
