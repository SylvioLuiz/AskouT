import { RECO_GOING_HISTORY, RECO_HISTORY_DAYS, RECO_TASTE_COMMENT, RECO_TASTE_GOING, RECO_TASTE_LIKE, RECO_TASTE_SHARE, hashtagsOf, stickyThreshold, stickyWeight } from './recommendation-service.ts';
import { validatedInterests } from './match.ts';
import type { InterestSignal, ValidatedInterest } from './match.ts';
import type { CoreDeps } from './ports.ts';
import type { DwellRecord } from './types.ts';

/**
 * Reúne os gestos da PRÓPRIA pessoa sobre conteúdos com hashtag e aplica a regra do gosto validado (core/match.ts).
 * Lê os mesmos dados do motor "Para você", mas não olha amigos.
 */
export class InterestService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async signalsOf(userId: string, now: Date): Promise<InterestSignal[]> {
    const { posts, places, eventRoom, dwell: dwellRepo } = this.deps;
    const since = new Date(now.getTime() - RECO_HISTORY_DAYS * 86_400_000);
    const out: InterestSignal[] = [];
    const postTags = new Map<string, string[] | null>();
    const tagsOfPost = async (id: string) => {
      if (!postTags.has(id)) {
        const p = await posts.findById(id);
        postTags.set(id, p && !p.post.archivedAt ? hashtagsOf(p.post.caption) : null);
      }
      return postTags.get(id) ?? null;
    };
    const eventTags = new Map<string, string[] | null>();
    const tagsOfEvent = async (id: string) => {
      if (!eventTags.has(id)) eventTags.set(id, (await places.findEvent(id))?.event.tags ?? null);
      return eventTags.get(id) ?? null;
    };
    const push = (type: 'POST' | 'EVENT', id: string, at: Date, weight: number, tags: string[] | null) => {
      if (tags && tags.length > 0 && weight > 0) out.push({ contentKey: `${type}:${id}`, at, weight, tags });
    };

    for (const row of await posts.listEngagement(userId, since, 500)) push('POST', row.postId, row.at, row.kind === 'COMMENT' ? RECO_TASTE_COMMENT : RECO_TASTE_LIKE, await tagsOfPost(row.postId));
    for (const { ref, createdAt } of await eventRoom.listGoingByUser(userId, RECO_GOING_HISTORY)) {
      if (ref.source === 'PLACE') push('EVENT', ref.id, createdAt, RECO_TASTE_GOING, await tagsOfEvent(ref.id));
      else push('POST', ref.id, createdAt, RECO_TASTE_GOING, await tagsOfPost(ref.id));
    }
    const dwell: DwellRecord[] = await dwellRepo.listByUser(userId, since, 1000);
    const threshold = stickyThreshold(dwell.filter((d) => d.ms > 0));
    for (const d of dwell) {
      const weight = (d.shared === true ? RECO_TASTE_SHARE : 0) + stickyWeight(d.ms, threshold);
      if (weight <= 0) continue;
      push(d.targetType, d.targetId, d.createdAt, weight, d.targetType === 'POST' ? await tagsOfPost(d.targetId) : await tagsOfEvent(d.targetId));
    }
    return out;
  }

  async interestsOf(userId: string, now: Date): Promise<ValidatedInterest[]> {
    return validatedInterests(await this.signalsOf(userId, now), now);
  }
}
