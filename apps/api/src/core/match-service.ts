import { boundingBox, distanceMeters } from './geo.ts';
import type { InterestService } from './interest-service.ts';
import { MATCH_ESTIMATE_SCAN, audienceBucket } from './match.ts';
import type { CoreDeps } from './ports.ts';
import type { BoostRecord, PlaceEventRecord, VenueRecord } from './types.ts';

export interface MatchReach {
  /** Menos de 10 pessoas: o número não é mostrado. */
  low: boolean;
  /** Arredondado para baixo de 10 em 10; `null` quando `low`. */
  people: number | null;
  label: string;
  /** A conta examinou só parte das pessoas da região (há mais gente que o limite de leitura). */
  partial: boolean;
}

export interface MatchPick {
  boost: BoostRecord;
  event: PlaceEventRecord;
  venue: VenueRecord;
  /** A hashtag validada da pessoa que casou com as do anúncio (a de maior peso). */
  tag: string;
  distanceM: number;
}

/**
 * Match = quem mora no raio escolhido pelo responsável E tem o gosto validado por uma das hashtags escolhidas.
 *  - `reach`: quantas pessoas combinam hoje, só como número agregado (nunca quem).
 *  - `forViewer`: os anúncios Match que valem para uma pessoa, na hora de montar o "Para você".
 */
export class MatchService {
  private readonly deps: CoreDeps;
  private readonly interests: InterestService;

  constructor(deps: CoreDeps, interests: InterestService) {
    this.deps = deps;
    this.interests = interests;
  }

  async reach(input: { venue: VenueRecord; radiusM: number; tags: readonly string[]; ownerId: string }): Promise<MatchReach> {
    const now = this.deps.clock.now();
    const center = { lat: input.venue.lat, lng: input.venue.lng };
    const rows = await this.deps.regions.listInBox(boundingBox(center, input.radiusM), MATCH_ESTIMATE_SCAN + 1);
    const partial = rows.length > MATCH_ESTIMATE_SCAN;
    let count = 0;
    for (const r of rows.slice(0, MATCH_ESTIMATE_SCAN)) {
      if (r.userId === input.ownerId || distanceMeters(center, r) > input.radiusM) continue;
      const user = await this.deps.users.findById(r.userId);
      if (!user || user.status !== 'ACTIVE') continue;
      if (await this.deps.blocks.existsEitherWay(input.ownerId, r.userId)) continue;
      const mine = await this.interests.interestsOf(r.userId, now);
      if (mine.some((i) => input.tags.includes(i.tag))) count += 1;
    }
    return { ...audienceBucket(count), partial };
  }

  /** Anúncios Match que valem para a pessoa agora, do que mais combina para o que menos combina. Sem região salva, nenhum. */
  async forViewer(viewerId: string, now: Date): Promise<MatchPick[]> {
    const active = (await this.deps.boosts.listActive(now)).filter((b) => b.audience === 'MATCH' && b.target === 'EVENT' && b.eventId !== null && b.radiusM !== null && b.ownerId !== viewerId);
    if (active.length === 0) return [];
    const region = await this.deps.regions.find(viewerId);
    if (!region) return [];
    const mine = await this.interests.interestsOf(viewerId, now);
    if (mine.length === 0) return [];

    const picks: (MatchPick & { weight: number })[] = [];
    for (const boost of active) {
      const found = await this.deps.places.findEvent(boost.eventId as string);
      if (!found || found.event.endsAt.getTime() <= now.getTime()) continue;
      const distanceM = distanceMeters(region, found.venue);
      if (distanceM > (boost.radiusM as number)) continue;
      const matched = mine.find((i) => boost.matchTags.includes(i.tag));
      if (!matched) continue;
      if (await this.deps.blocks.existsEitherWay(viewerId, boost.ownerId)) continue;
      picks.push({ boost, event: found.event, venue: found.venue, tag: matched.tag, distanceM, weight: matched.weight });
    }
    return picks.sort((a, b) => b.weight - a.weight || a.distanceM - b.distanceM || (a.boost.id < b.boost.id ? -1 : 1)).map(({ weight: _weight, ...pick }) => pick);
  }
}
