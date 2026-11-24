import { notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ReferralService } from './referral-service.ts';
import type { Actor, EventRef } from './types.ts';

/**
 * Selos do perfil. Cada selo sai de algo que a pessoa fez de verdade no app, e as regras foram pensadas para que
 * contas falsas (ou combinadas entre amigos) não rendam selo fácil. As regras também estão em GOLIVE.md.
 *
 *  - REFERRAL "Trouxe a galera": amigos confirmados pelo convite (regras em referral-service.ts).
 *  - ORGANIZER "Organizador": criou um evento (de pessoa, não em nome de um local) que já começou e teve pelo menos
 *    ORGANIZER_MIN_GUESTS pessoas confirmadas. Só contam convidados com conta ativa, sem bloqueio com quem organizou,
 *    criada pelo menos GUEST_ACCOUNT_MIN_DAYS antes do evento, e que confirmaram antes do fim do evento.
 *  - REGULAR "Figurinha carimbada": confirmou presença em REGULAR_MIN_EVENTS eventos que já acabaram. Não contam
 *    eventos da própria pessoa, eventos de exemplo, confirmações feitas depois do fim, nem eventos com menos de
 *    REGULAR_MIN_CROWD confirmados (ela incluída). De cada organizador (pessoa ou local) contam no máximo
 *    REGULAR_PER_ORGANIZER eventos: um amigo criando vários eventos vazios não basta.
 *  - NOW "Topa tudo": encontrou pelo NOW (convite aceito) NOW_MIN_PEOPLE pessoas diferentes. Conta pessoas, não
 *    encontros: repetir encontros com a mesma conta não adianta. Só contas ativas e sem bloqueio.
 *
 * A pessoa pode esconder qualquer selo do perfil; escondido, só ela o vê (marcado como escondido).
 */
export const ORGANIZER_MIN_GUESTS = 10;
export const GUEST_ACCOUNT_MIN_DAYS = 7;
export const REGULAR_MIN_EVENTS = 10;
export const REGULAR_MIN_CROWD = 3;
export const REGULAR_PER_ORGANIZER = 2;
export const NOW_MIN_PEOPLE = 5;
/** Quantos itens recentes olhar em cada conta (eventos criados, presenças e encontros). */
export const BADGE_SCAN_LIMIT = 300;
/** As contagens de quem visita ficam guardadas por este tempo (o próprio perfil sempre recalcula). */
export const BADGE_CACHE_MS = 10 * 60_000;
const BADGE_CACHE_MAX = 5000;

export const BADGE_IDS = ['REFERRAL', 'ORGANIZER', 'REGULAR', 'NOW'] as const;
export type BadgeId = (typeof BADGE_IDS)[number];

export interface ProfileBadgeView {
  id: BadgeId;
  /** Amigos confirmados (REFERRAL), eventos (ORGANIZER e REGULAR) ou pessoas (NOW). */
  count: number;
  /** Mínimo para ganhar o selo (o app mostra na explicação). */
  threshold: number;
  /** Só aparece no próprio perfil: o selo está escondido para os outros. */
  hidden: boolean;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Evento de pessoa sem horário de fim: considera que acaba 4 h depois de começar. */
const DEFAULT_EVENT_HOURS = 4;
const hiddenKey = (userId: string) => `profile-badges-hidden:${userId}`;

type Counts = Record<Exclude<BadgeId, 'REFERRAL'>, number>;

export class BadgeService {
  private readonly deps: CoreDeps;
  private readonly referrals: ReferralService;
  private readonly cache = new Map<string, { at: number; counts: Counts }>();

  constructor(deps: CoreDeps, referrals: ReferralService) {
    this.deps = deps;
    this.referrals = referrals;
  }

  /** Selos do perfil de `userId`. Quem visita não vê os escondidos; a própria pessoa vê todos que ganhou. */
  async forProfile(userId: string, viewerId: string): Promise<ProfileBadgeView[]> {
    const self = userId === viewerId;
    const [counts, referral, referralHidden, hidden] = await Promise.all([
      this.counts(userId, self),
      this.referrals.badgeCount(userId),
      this.referrals.isBadgeHidden(userId),
      this.hiddenSet(userId),
    ]);
    const all: ProfileBadgeView[] = [];
    if (referral !== null) all.push({ id: 'REFERRAL', count: referral.confirmed, threshold: referral.threshold, hidden: referralHidden });
    if (counts.ORGANIZER >= 1) all.push({ id: 'ORGANIZER', count: counts.ORGANIZER, threshold: ORGANIZER_MIN_GUESTS, hidden: hidden.has('ORGANIZER') });
    if (counts.REGULAR >= REGULAR_MIN_EVENTS) all.push({ id: 'REGULAR', count: counts.REGULAR, threshold: REGULAR_MIN_EVENTS, hidden: hidden.has('REGULAR') });
    if (counts.NOW >= NOW_MIN_PEOPLE) all.push({ id: 'NOW', count: counts.NOW, threshold: NOW_MIN_PEOPLE, hidden: hidden.has('NOW') });
    return self ? all : all.filter((b) => !b.hidden);
  }

  /** Esconde ou mostra um selo no próprio perfil. */
  async setHidden(actor: Actor, rawId: unknown, rawHidden: unknown): Promise<{ id: BadgeId; hidden: boolean }> {
    const id = BADGE_IDS.find((b) => b === rawId);
    if (!id) throw notFound('Selo não encontrado');
    if (typeof rawHidden !== 'boolean') throw validationError('Dados inválidos', { hidden: 'Informe true ou false' });
    if (id === 'REFERRAL') {
      await this.referrals.setBadgeHidden(actor, rawHidden);
      return { id, hidden: rawHidden };
    }
    const set = await this.hiddenSet(actor.userId);
    if (rawHidden) set.add(id);
    else set.delete(id);
    await this.deps.settings.set({ key: hiddenKey(actor.userId), value: [...set].join(','), updatedAt: this.deps.clock.now(), updatedBy: actor.userId });
    return { id, hidden: rawHidden };
  }

  private async hiddenSet(userId: string): Promise<Set<BadgeId>> {
    const raw = (await this.deps.settings.get(hiddenKey(userId)))?.value ?? '';
    return new Set(raw.split(',').flatMap((v) => BADGE_IDS.filter((b) => b === v)));
  }

  private async counts(userId: string, fresh: boolean): Promise<Counts> {
    const now = this.deps.clock.now().getTime();
    const cached = this.cache.get(userId);
    if (!fresh && cached && now - cached.at < BADGE_CACHE_MS) return cached.counts;
    const related = new Set(await this.deps.blocks.listRelatedIds(userId));
    const [ORGANIZER, REGULAR, NOW] = await Promise.all([this.organizedEvents(userId, related), this.attendedEvents(userId, related), this.nowPeople(userId, related)]);
    const counts = { ORGANIZER, REGULAR, NOW };
    if (this.cache.size >= BADGE_CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.delete(userId);
    this.cache.set(userId, { at: now, counts });
    return counts;
  }

  /** Eventos criados pela pessoa que já começaram e reuniram ORGANIZER_MIN_GUESTS convidados que valem. */
  private async organizedEvents(userId: string, related: Set<string>): Promise<number> {
    const { posts, eventRoom, users, clock } = this.deps;
    const now = clock.now();
    const events = (await posts.listFor([userId], [], { limit: BADGE_SCAN_LIMIT, offset: 0 }, 'EVENT'))
      .map((p) => p.post)
      .filter((p) => p.authorId === userId && !p.venueId && p.eventTitle !== null && p.eventStartsAt !== null && p.eventStartsAt <= now);
    if (events.length === 0) return 0;
    const sizes = await eventRoom.countGoing(events.map((p) => ({ source: 'USER', id: p.id })));
    const accounts = new Map<string, { createdAt: Date } | null>();
    let total = 0;
    for (const post of events) {
      if ((sizes.get(post.id) ?? 0) < ORGANIZER_MIN_GUESTS) continue;
      const startsAt = post.eventStartsAt as Date;
      const endsAt = post.eventEndsAt ?? new Date(startsAt.getTime() + DEFAULT_EVENT_HOURS * HOUR_MS);
      const newestAccount = startsAt.getTime() - GUEST_ACCOUNT_MIN_DAYS * DAY_MS;
      let guests = 0;
      for (const g of await eventRoom.listGoing({ source: 'USER', id: post.id })) {
        if (g.userId === userId || related.has(g.userId) || g.createdAt > endsAt) continue;
        if (!accounts.has(g.userId)) {
          const u = await users.findById(g.userId);
          accounts.set(g.userId, u && u.status === 'ACTIVE' ? { createdAt: u.createdAt } : null);
        }
        const account = accounts.get(g.userId);
        if (account && account.createdAt.getTime() <= newestAccount) guests += 1;
        if (guests >= ORGANIZER_MIN_GUESTS) break;
      }
      if (guests >= ORGANIZER_MIN_GUESTS) total += 1;
    }
    return total;
  }

  /** Eventos que já acabaram em que a pessoa confirmou presença, seguindo as regras do REGULAR. */
  private async attendedEvents(userId: string, related: Set<string>): Promise<number> {
    const { eventRoom, places, posts, clock } = this.deps;
    const now = clock.now();
    const going = await eventRoom.listGoingByUser(userId, BADGE_SCAN_LIMIT);
    const candidates: { ref: EventRef; organizer: string }[] = [];
    for (const g of going) {
      const event = await this.eventInfo(g.ref, places, posts);
      if (!event || event.ownerId === userId || (event.ownerId && related.has(event.ownerId))) continue;
      if (event.endsAt > now || g.createdAt > event.endsAt) continue;
      candidates.push({ ref: g.ref, organizer: event.organizer });
    }
    if (candidates.length === 0) return 0;
    const sizes = await eventRoom.countGoing(candidates.map((c) => c.ref));
    const perOrganizer = new Map<string, number>();
    let total = 0;
    for (const c of candidates) {
      if ((sizes.get(c.ref.id) ?? 0) < REGULAR_MIN_CROWD) continue;
      const used = perOrganizer.get(c.organizer) ?? 0;
      if (used >= REGULAR_PER_ORGANIZER) continue;
      perOrganizer.set(c.organizer, used + 1);
      total += 1;
    }
    return total;
  }

  private async eventInfo(ref: EventRef, places: CoreDeps['places'], posts: CoreDeps['posts']): Promise<{ endsAt: Date; organizer: string; ownerId: string | null } | null> {
    if (ref.source === 'PLACE') {
      const found = await places.findEvent(ref.id);
      if (!found || found.event.isSample) return null;
      return { endsAt: found.event.endsAt, organizer: `V:${found.venue.id}`, ownerId: null };
    }
    const post = (await posts.findById(ref.id))?.post;
    if (!post || post.eventStartsAt === null) return null;
    const endsAt = post.eventEndsAt ?? new Date(post.eventStartsAt.getTime() + DEFAULT_EVENT_HOURS * HOUR_MS);
    return { endsAt, organizer: post.venueId ? `V:${post.venueId}` : `U:${post.authorId}`, ownerId: post.authorId };
  }

  /** Pessoas diferentes encontradas pelo NOW (álbuns dos encontros guardam quem foi). */
  private async nowPeople(userId: string, related: Set<string>): Promise<number> {
    const { albums, users, clock } = this.deps;
    const now = clock.now();
    const rows = (await albums.listForUser(userId, new Date(0), BADGE_SCAN_LIMIT)).filter((a) => a.kind === 'FLASH' && a.startedAt <= now);
    const people = new Set<string>();
    for (const album of rows) {
      for (const id of await albums.listMembers(album.id)) if (id !== userId && !related.has(id)) people.add(id);
    }
    if (people.size < NOW_MIN_PEOPLE) return people.size;
    // findProfilesByIds já ignora contas suspensas.
    return (await users.findProfilesByIds([...people])).length;
  }
}
