import { buildEventCards } from './event-card.ts';
import type { EventCardView } from './event-card.ts';
import { fold, normalizeTag } from './explore-match.ts';
import type { MatchPick, MatchService } from './match-service.ts';
import { MATCH_MAX_PER_VIEW } from './match.ts';
import type { PostService, PostView } from './post-service.ts';
import type { CoreDeps } from './ports.ts';
import type { DirectActivityRow, DwellRecord, EventKind, PostRecord, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';
import { validationError } from './errors.ts';

export const RECO_DEFAULT_LIMIT = 6;
export const RECO_MAX_LIMIT = 10;
/** Janela de memória do que a pessoa curtiu, comentou ou olhou. */
export const RECO_HISTORY_DAYS = 60;
/** Quanto tempo atrás uma interação vale metade. */
export const RECO_HALF_LIFE_DAYS = 14;
/** Só olhar o que os amigos curtiram/foram nas últimas semanas. */
export const RECO_FRIEND_DAYS = 14;
/** Menos medições que isto e ainda não há média confiável: usa só o piso. */
export const RECO_MIN_SAMPLES = 8;
/** Um conteúdo só "prende" se passou disso, mesmo que a média da pessoa seja menor. */
export const RECO_MIN_STICKY_MS = 3000;
/** Quem já olhou o post por mais que isto não recebe o mesmo post de novo. */
export const RECO_SEEN_MS = 1500;
/** O mesmo evento aparecendo tantas vezes no bloco sem clique cansa: para de mostrar. */
export const RECO_MAX_IMPRESSIONS = 3;
/** Quanto cada gesto explícito pesa no gosto (tempo na tela vai de 1 a 2). Compartilhar é o mais forte. */
export const RECO_TASTE_LIKE = 1.5;
export const RECO_TASTE_COMMENT = 2;
export const RECO_TASTE_SHARE = 2.5;
/** Confirmar presença é um compromisso: pesa como compartilhar. */
export const RECO_TASTE_GOING = 2.5;
/** Quantos eventos confirmados da própria pessoa entram no gosto. */
export const RECO_GOING_HISTORY = 50;
/**
 * O gosto dos amigos mais próximos também puxa as recomendações, mas menos que as ações da própria pessoa:
 * o gesto de um amigo vale (peso do gesto) x (proximidade, de 0,1 a 1) x este fator. Um amigo no máximo de proximidade
 * pesa 60% do mesmo gesto feito pela própria pessoa.
 */
export const RECO_FRIEND_TASTE_FACTOR = 0.6;
/** Só os amigos mais próximos influenciam o gosto. */
export const RECO_TASTE_FRIENDS = 10;
export const RECO_MAX_FRIENDS = 30;
export const RECO_MAX_PER_SOURCE = 2;
export const RECO_WEIGHTS = { social: 0.55, taste: 0.35, fresh: 0.1 } as const;

/** Características de um conteúdo, usadas para comparar com o gosto. */
export interface Features {
  tags: string[];
  kind: EventKind | null;
  venueId: string | null;
  authorId: string | null;
  category: string | null;
}

export interface Taste {
  tags: Map<string, number>;
  kinds: Map<string, number>;
  venues: Map<string, number>;
  authors: Map<string, number>;
  categories: Map<string, number>;
}

export function emptyTaste(): Taste {
  return { tags: new Map(), kinds: new Map(), venues: new Map(), authors: new Map(), categories: new Map() };
}

export function isEmptyTaste(t: Taste): boolean {
  return t.tags.size + t.kinds.size + t.venues.size + t.authors.size + t.categories.size === 0;
}

const bump = (m: Map<string, number>, key: string | null, w: number) => {
  if (key) m.set(key, (m.get(key) ?? 0) + w);
};

export function addFeatures(taste: Taste, f: Features, weight: number): void {
  for (const t of f.tags) bump(taste.tags, t, weight);
  bump(taste.kinds, f.kind && f.kind !== 'OTHER' ? f.kind : null, weight);
  bump(taste.venues, f.venueId, weight);
  bump(taste.authors, f.authorId, weight);
  bump(taste.categories, f.category, weight);
}

const top = (m: Map<string, number>) => Math.max(0, ...m.values());
const rel = (m: Map<string, number>, key: string | null) => (key && top(m) > 0 ? (m.get(key) ?? 0) / top(m) : 0);

/** 0 a 1: o quanto um conteúdo se parece com o que prendeu a pessoa. Local, autor, tipo, categoria e hashtags. */
export function tasteSimilarity(taste: Taste, f: Features): number {
  const tags = f.tags.reduce((sum, t) => sum + rel(taste.tags, t), 0);
  const kind = f.kind && f.kind !== 'OTHER' ? rel(taste.kinds, f.kind) : 0;
  return Math.min(1, 0.35 * rel(taste.venues, f.venueId) + 0.25 * rel(taste.authors, f.authorId) + 0.25 * kind + 0.15 * rel(taste.categories, f.category) + Math.min(0.5, 0.25 * tags));
}

/** Peso de uma interação que envelhece: vale metade a cada `RECO_HALF_LIFE_DAYS`. */
export function decay(at: Date, now: Date, halfLifeDays = RECO_HALF_LIFE_DAYS): number {
  const days = Math.max(0, (now.getTime() - at.getTime()) / 86_400_000);
  return 0.5 ** (days / halfLifeDays);
}

/** Limite a partir do qual um conteúdo "prendeu": a média da pessoa (com ao menos `RECO_MIN_SAMPLES` medições), nunca menos que o piso. */
export function stickyThreshold(rows: readonly { ms: number }[]): number {
  if (rows.length < RECO_MIN_SAMPLES) return RECO_MIN_STICKY_MS;
  const mean = rows.reduce((a, r) => a + r.ms, 0) / rows.length;
  return Math.max(RECO_MIN_STICKY_MS, mean);
}

/** Peso de um conteúdo que prendeu: cresce devagar com o tempo a mais que a média. */
export function stickyWeight(ms: number, threshold: number): number {
  return ms > threshold ? Math.min(2, 1 + Math.log(ms / threshold)) : 0;
}

/** Quanto as conversas 1 a 1 pesam na proximidade, frente a curtida (1) e comentário (2). */
export const RECO_DM_WEIGHT = 1.5;
export const RECO_DM_ROWS = 3000;

/**
 * Proximidade por mensagens diretas, por amigo. Conta por dia (o 20º "oi" do dia vale pouco mais que o 2º: log),
 * quem manda pesa mais que quem recebe, e dia antigo vale menos. Nunca lê o texto.
 */
export function directCloseness(rows: readonly DirectActivityRow[], now: Date): Map<string, number> {
  const days = new Map<string, { otherId: string; at: Date; sent: number; received: number }>();
  for (const r of rows) {
    const day = r.at.toISOString().slice(0, 10);
    const key = `${r.otherId}|${day}`;
    const d = days.get(key) ?? { otherId: r.otherId, at: r.at, sent: 0, received: 0 };
    if (r.mine) d.sent += 1;
    else d.received += 1;
    days.set(key, d);
  }
  const out = new Map<string, number>();
  for (const d of days.values()) out.set(d.otherId, (out.get(d.otherId) ?? 0) + RECO_DM_WEIGHT * decay(d.at, now) * (Math.log1p(d.sent) + 0.5 * Math.log1p(d.received)));
  return out;
}

export function hashtagsOf(caption: string | null): string[] {
  if (!caption) return [];
  const found = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  return [...new Set(found.map((t) => normalizeTag(t)).filter(Boolean))];
}

export function finalScore(social: number, taste: number, fresh: number, personalize: boolean): number {
  const w = RECO_WEIGHTS;
  const s = Math.min(1, social);
  return personalize ? w.social * s + w.taste * taste + w.fresh * fresh : (w.social + w.taste) * s + w.fresh * fresh;
}

/** Quem fez o post ou o evento (pessoa ou estabelecimento) e se a pessoa que vê já segue. A Home mostra o botão Seguir. */
export interface RecommendationSource {
  kind: 'PERSON' | 'VENUE';
  /** Id do usuário (pessoa) ou do local (estabelecimento). */
  id: string;
  /** Pessoa: @usuário. Local: nome. */
  name: string;
  /** Só pessoa: para abrir o perfil. */
  username: string | null;
  /** NONE: pode seguir. PENDING: pedido enviado (perfil privado). FOLLOWING: já segue. */
  follow: 'NONE' | 'PENDING' | 'FOLLOWING';
}

export interface RecommendationItem {
  type: 'EVENT' | 'POST';
  /** 0 a 1. */
  score: number;
  reasons: string[];
  /** Amigos que vão (a lista de presença do evento já é pública). */
  friendsGoing: PublicProfile[];
  /** Quantos amigos curtiram ou comentaram (sem dizer quem). */
  friendsEngaged: number;
  event: EventCardView | null;
  post: PostView | null;
  /** Anúncio pago (Match). A tela mostra “Patrocinado”. */
  sponsored: boolean;
  /** Só no Match: por que combina com a pessoa. Nunca revela dados de outras pessoas. */
  match: { tag: string; distanceKm: number } | null;
  /** Quem fez o conteúdo. */
  source: RecommendationSource | null;
}

export interface RecommendationsView {
  /** false quando a pessoa desligou o uso do comportamento dela: só vale o que amigos fizeram. */
  personalized: boolean;
  items: RecommendationItem[];
}

interface Candidate {
  type: 'EVENT' | 'POST';
  id: string;
  features: Features;
  social: number;
  going: Set<string>;
  engaged: Set<string>;
  /** Evento que ainda vai começar (urgência) ou post recente. */
  freshness: number;
}

/**
 * Motor de recomendação da Home ("Para você").
 *  1. Proximidade: quem são os amigos com quem a pessoa mais interage (mensagens diretas, curtidas, comentários e tempo olhando os posts deles; as mais recentes pesam mais).
 *  2. Social: eventos a que esses amigos vão e posts que curtiram ou comentaram, pesados pela proximidade.
 *  3. Gosto: o que prendeu a pessoa (ficou mais tempo na tela que a média dela) vira hashtags, tipo de evento, local e autor preferidos;
 *     eventos parecidos entram mesmo sem amigos.
 * Não mostra o que a pessoa já viu, já curtiu ou já vai. Nunca revela quem curtiu o quê.
 */
export class RecommendationService {
  private readonly deps: CoreDeps;
  private readonly postService: PostService;
  private readonly matchService: MatchService;

  constructor(deps: CoreDeps, postService: PostService, matchService: MatchService) {
    this.deps = deps;
    this.postService = postService;
    this.matchService = matchService;
  }

  /** Quem fez o post/evento e se a pessoa já segue: estabelecimento (evento de local, post de local) ou pessoa (post comum). */
  private async sourceOf(viewerId: string, event: EventCardView | null, post: PostView | null): Promise<RecommendationSource | null> {
    if (post && !post.venue) {
      if (post.author.userId === viewerId) return null;
      const f = await this.deps.follows.get(viewerId, post.author.userId);
      return { kind: 'PERSON', id: post.author.userId, name: post.author.username, username: post.author.username, follow: f ? (f.status === 'ACCEPTED' ? 'FOLLOWING' : 'PENDING') : 'NONE' };
    }
    const venue = post?.venue ? { id: post.venue.id, name: post.venue.name } : event && event.venueId ? { id: event.venueId, name: event.venueName } : null;
    if (!venue) return null;
    const following = await this.deps.places.isFollowingVenue(viewerId, venue.id);
    return { kind: 'VENUE', id: venue.id, name: venue.name, username: null, follow: following ? 'FOLLOWING' : 'NONE' };
  }

  async recommend(viewerId: string, input: { personalize?: unknown; limit?: unknown } = {}): Promise<RecommendationsView> {
    const personalize = input.personalize === undefined ? true : input.personalize === true;
    if (input.limit !== undefined && (typeof input.limit !== 'number' || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > RECO_MAX_LIMIT)) {
      throw validationError('Limite inválido', { limit: `Entre 1 e ${RECO_MAX_LIMIT}` });
    }
    const limit = (input.limit as number | undefined) ?? RECO_DEFAULT_LIMIT;
    const { clock, posts, places, eventRoom } = this.deps;
    const now = clock.now();
    const since = new Date(now.getTime() - RECO_HISTORY_DAYS * 86_400_000);

    const postCache = new Map<string, Awaited<ReturnType<typeof posts.findById>>>();
    const postOf = async (id: string) => {
      if (!postCache.has(id)) postCache.set(id, await posts.findById(id));
      return postCache.get(id);
    };
    const postFeatures = (p: PostRecord): Features => ({ tags: hashtagsOf(p.caption), kind: p.eventTitle ? p.eventKind : null, venueId: p.venueId ?? null, authorId: p.authorId, category: null });
    const eventFeatures = (e: { tags: string[]; kind: EventKind; venueId: string }, category: string | null): Features => ({ tags: e.tags, kind: e.kind, venueId: e.venueId, authorId: null, category: category ? fold(category) : null });

    const friendIds = await this.deps.follows.listFriendIds(viewerId);
    const friendSet = new Set(friendIds);

    // Medições de permanência (só se a pessoa não desligou).
    const dwell: DwellRecord[] = personalize ? await this.deps.dwell.listByUser(viewerId, since, 1000) : [];
    // Cliques e compartilhamentos sem tempo (0 ms) não entram na média de tempo da pessoa.
    const threshold = stickyThreshold(dwell.filter((d) => d.ms > 0));

    // 1. Proximidade com cada amigo.
    const raw = new Map<string, number>();
    const add = (friendId: string | undefined, w: number) => {
      if (friendId && friendSet.has(friendId)) raw.set(friendId, (raw.get(friendId) ?? 0) + w);
    };
    const mine = await posts.listEngagement(viewerId, since, 500);
    const viewerEngaged = new Set(mine.map((m) => m.postId));
    for (const row of mine) add((await postOf(row.postId))?.post.authorId, (row.kind === 'COMMENT' ? 2 : 1) * decay(row.at, now));
    for (const d of dwell) {
      const w = d.targetType === 'POST' ? stickyWeight(d.ms, threshold) : 0;
      if (w > 0) add((await postOf(d.targetId))?.post.authorId, 1.5 * w * decay(d.createdAt, now));
    }
    if (personalize) for (const [id, w] of directCloseness(await this.deps.conversations.directActivity(viewerId, since, RECO_DM_ROWS), now)) add(id, w);
    const maxRaw = Math.max(0, ...raw.values());
    const closeness = (id: string) => 0.1 + (maxRaw > 0 ? 0.9 * ((raw.get(id) ?? 0) / maxRaw) : 0);
    const circle = [...friendIds].sort((a, b) => closeness(b) - closeness(a) || (a < b ? -1 : 1)).slice(0, RECO_MAX_FRIENDS);

    // 2. Gosto a partir do que prendeu.
    const taste = emptyTaste();
    if (personalize) {
      // Gestos explícitos: o que a pessoa curtiu, comentou ou compartilhou diz mais que o tempo na tela.
      for (const row of mine) {
        const p = await postOf(row.postId);
        if (p) addFeatures(taste, postFeatures(p.post), (row.kind === 'COMMENT' ? RECO_TASTE_COMMENT : RECO_TASTE_LIKE) * decay(row.at, now, 30));
      }
      for (const { ref, createdAt } of await eventRoom.listGoingByUser(viewerId, RECO_GOING_HISTORY)) {
        const w = RECO_TASTE_GOING * decay(createdAt, now, 30);
        if (ref.source === 'PLACE') {
          const e = await places.findEvent(ref.id);
          if (e) addFeatures(taste, eventFeatures(e.event, e.venue.category), w);
        } else {
          const p = await postOf(ref.id);
          if (p && p.post.eventTitle) addFeatures(taste, postFeatures(p.post), w);
        }
      }
      for (const d of dwell) {
        if (d.shared !== true) continue;
        const w = RECO_TASTE_SHARE * decay(d.createdAt, now, 30);
        if (d.targetType === 'POST') {
          const p = await postOf(d.targetId);
          if (p) addFeatures(taste, postFeatures(p.post), w);
        } else {
          const e = await places.findEvent(d.targetId);
          if (e) addFeatures(taste, eventFeatures(e.event, e.venue.category), w);
        }
      }
      for (const d of dwell) {
        const w = stickyWeight(d.ms, threshold) * decay(d.createdAt, now, 30);
        if (w <= 0) continue;
        if (d.targetType === 'POST') {
          const p = await postOf(d.targetId);
          if (p) addFeatures(taste, postFeatures(p.post), w);
        } else {
          const e = await places.findEvent(d.targetId);
          if (e) addFeatures(taste, eventFeatures(e.event, e.venue.category), w);
        }
      }
    }

    // O que ela já viu ou já fez não volta.
    const seenPosts = new Set(dwell.filter((d) => d.targetType === 'POST' && (d.ms >= RECO_SEEN_MS || d.shared === true)).map((d) => d.targetId));
    const sharedEvents = new Set(dwell.filter((d) => d.targetType === 'EVENT' && d.shared === true).map((d) => d.targetId));
    const impressions = new Map<string, number>();
    for (const d of dwell) if (d.targetType === 'EVENT' && d.source === 'RECO' && d.ms > 0) impressions.set(d.targetId, (impressions.get(d.targetId) ?? 0) + 1);

    // 3. Candidatos.
    const cands = new Map<string, Candidate>();
    const candidate = (type: 'EVENT' | 'POST', id: string, features: Features, freshness: number): Candidate => {
      const key = `${type}:${id}`;
      let c = cands.get(key);
      if (!c) {
        c = { type, id, features, social: 0, going: new Set(), engaged: new Set(), freshness };
        cands.set(key, c);
      }
      return c;
    };
    const upcomingFreshness = (startsAt: Date) => {
      const hours = (startsAt.getTime() - now.getTime()) / 3_600_000;
      return hours <= 48 ? 1 : hours <= 24 * 7 ? 0.5 : 0.2;
    };
    const postFreshness = (createdAt: Date) => 0.5 ** ((now.getTime() - createdAt.getTime()) / 86_400_000 / 3);

    // O que cada amigo próximo foi ou curtiu, lido uma vez só: serve de candidato e de gosto.
    const friendData = new Map<string, { going: Awaited<ReturnType<typeof eventRoom.listGoingByUser>>; engaged: Awaited<ReturnType<typeof posts.listEngagement>> }>();
    for (const friendId of circle) {
      friendData.set(friendId, {
        going: await eventRoom.listGoingByUser(friendId, 20),
        engaged: await posts.listEngagement(friendId, new Date(now.getTime() - RECO_FRIEND_DAYS * 86_400_000), 30),
      });
    }

    // Gosto dos amigos mais próximos, com peso menor que o das ações da própria pessoa.
    if (personalize) {
      const close = circle.slice(0, RECO_TASTE_FRIENDS);
      const postIds = close.flatMap((f) => [...(friendData.get(f)?.engaged.map((r) => r.postId) ?? []), ...(friendData.get(f)?.going.filter((g) => g.ref.source === 'USER').map((g) => g.ref.id) ?? [])]);
      const visible = await this.postService.visibleIds(viewerId, postIds);
      for (const friendId of close) {
        const k = closeness(friendId) * RECO_FRIEND_TASTE_FACTOR;
        const data = friendData.get(friendId)!;
        for (const row of data.engaged) {
          const p = visible.has(row.postId) ? await postOf(row.postId) : undefined;
          if (p) addFeatures(taste, postFeatures(p.post), k * (row.kind === 'COMMENT' ? RECO_TASTE_COMMENT : RECO_TASTE_LIKE) * decay(row.at, now, 30));
        }
        for (const { ref, createdAt } of data.going) {
          const w = k * RECO_TASTE_GOING * decay(createdAt, now, 30);
          if (ref.source === 'PLACE') {
            const e = await places.findEvent(ref.id);
            if (e) addFeatures(taste, eventFeatures(e.event, e.venue.category), w);
          } else if (visible.has(ref.id)) {
            const p = await postOf(ref.id);
            if (p) addFeatures(taste, postFeatures(p.post), w);
          }
        }
      }
    }

    for (const friendId of circle) {
      const w = closeness(friendId);
      const data = friendData.get(friendId)!;
      for (const { ref } of data.going) {
        if (ref.source === 'PLACE') {
          const e = await places.findEvent(ref.id);
          if (!e || e.event.endsAt <= now) continue;
          const c = candidate('EVENT', e.event.id, eventFeatures(e.event, e.venue.category), upcomingFreshness(e.event.startsAt));
          c.social += w;
          c.going.add(friendId);
        } else {
          const p = await postOf(ref.id);
          if (!p || p.post.authorId === viewerId || !p.post.eventEndsAt || p.post.eventEndsAt <= now || p.post.archivedAt) continue;
          const c = candidate('POST', p.post.id, postFeatures(p.post), upcomingFreshness(p.post.eventStartsAt ?? now));
          c.social += w;
          c.going.add(friendId);
        }
      }
      for (const row of data.engaged) {
        const p = await postOf(row.postId);
        if (!p || p.post.archivedAt || p.post.authorId === viewerId || p.post.authorId === friendId) continue;
        const c = candidate('POST', p.post.id, postFeatures(p.post), postFreshness(p.post.createdAt));
        c.social += w * (row.kind === 'COMMENT' ? 0.8 : 0.6);
        c.engaged.add(friendId);
      }
    }
    if (personalize && !isEmptyTaste(taste)) {
      const upcoming = await places.searchEvents({ from: now, to: new Date(now.getTime() + 14 * 86_400_000), limit: 200 });
      for (const { event, venue } of upcoming) candidate('EVENT', event.id, eventFeatures(event, venue.category), upcomingFreshness(event.startsAt));
    }

    // 4. Nota, filtros e diversidade.
    const scored: { c: Candidate; score: number; sim: number }[] = [];
    for (const c of cands.values()) {
      if (c.type === 'POST' && (seenPosts.has(c.id) || viewerEngaged.has(c.id))) continue;
      if (c.type === 'EVENT' && (sharedEvents.has(c.id) || (impressions.get(c.id) ?? 0) >= RECO_MAX_IMPRESSIONS || (await eventRoom.isGoing({ source: 'PLACE', id: c.id }, viewerId)))) continue;
      if (c.type === 'POST' && (await eventRoom.isGoing({ source: 'USER', id: c.id }, viewerId))) continue;
      const sim = personalize ? tasteSimilarity(taste, c.features) : 0;
      if (c.social === 0 && sim === 0) continue;
      scored.push({ c, sim, score: finalScore(c.social, sim, c.freshness, personalize) });
    }
    scored.sort((a, b) => b.score - a.score || (a.c.id < b.c.id ? -1 : 1));

    const perSource = new Map<string, number>();
    const picked: typeof scored = [];
    for (const row of scored) {
      const source = row.c.features.venueId ?? row.c.features.authorId ?? row.c.id;
      if ((perSource.get(source) ?? 0) >= RECO_MAX_PER_SOURCE) continue;
      // Posts precisam ser visíveis para quem está vendo (perfil privado, evento privado, bloqueio).
      if (row.c.type === 'POST' && (await this.postService.viewsByIds(viewerId, [row.c.id])).length === 0) continue;
      perSource.set(source, (perSource.get(source) ?? 0) + 1);
      picked.push(row);
      if (picked.length >= limit) break;
    }

    // 5. Montagem.
    const eventCards = await buildEventCards(this.deps, picked.filter((p) => p.c.type === 'EVENT').map((p) => p.c.id));
    const postViews = new Map((await this.postService.viewsByIds(viewerId, picked.filter((p) => p.c.type === 'POST').map((p) => p.c.id))).map((v) => [v.id, v] as const));
    const goingIds = [...new Set(picked.flatMap((p) => [...p.c.going]))];
    const profiles = new Map((await this.deps.users.findProfilesByIds(goingIds)).map((p) => [p.userId, toPublicProfile(p)] as const));

    const items: RecommendationItem[] = [];
    for (const { c, sim, score } of picked) {
      const event = c.type === 'EVENT' ? (eventCards.get(c.id) ?? null) : null;
      const post = c.type === 'POST' ? (postViews.get(c.id) ?? null) : null;
      if (!event && !post) continue;
      const friendsGoing = [...c.going].sort((a, b) => closeness(b) - closeness(a)).flatMap((id) => (profiles.has(id) ? [profiles.get(id) as PublicProfile] : [])).slice(0, 3);
      const reasons: string[] = [];
      if (c.going.size === 1 && friendsGoing[0]) reasons.push(`${friendsGoing[0].displayName} vai`);
      else if (c.going.size > 1 && friendsGoing[0]) reasons.push(`${friendsGoing[0].displayName} e mais ${c.going.size - 1} ${c.going.size - 1 === 1 ? 'amigo vão' : 'amigos vão'}`);
      if (c.engaged.size > 0) reasons.push(c.engaged.size === 1 ? '1 amigo curtiu ou comentou' : `${c.engaged.size} amigos curtiram ou comentaram`);
      if (sim > 0) {
        const tag = c.features.tags.find((t) => taste.tags.has(t));
        reasons.push(tag ? `Tem a ver com #${tag}` : c.features.venueId && taste.venues.has(c.features.venueId) ? 'De um rolê que você curte' : 'Parecido com o que você curte');
      }
      items.push({ type: c.type, score: Math.round(score * 100) / 100, reasons, friendsGoing, friendsEngaged: c.engaged.size, event, post, sponsored: false, match: null, source: await this.sourceOf(viewerId, event, post) });
    }

    // 6. Anúncios Match (pagos): só para quem tem região salva, mora no raio e tem o gosto validado. Entram em segundo lugar.
    if (personalize) {
      const picks: MatchPick[] = [];
      for (const pick of await this.matchService.forViewer(viewerId, now)) {
        const id = pick.event.id;
        if (sharedEvents.has(id) || (impressions.get(id) ?? 0) >= RECO_MAX_IMPRESSIONS || (await eventRoom.isGoing({ source: 'PLACE', id }, viewerId))) continue;
        picks.push(pick);
        if (picks.length >= MATCH_MAX_PER_VIEW) break;
      }
      const cards = await buildEventCards(this.deps, picks.map((p) => p.event.id));
      for (const pick of picks) {
        const event = cards.get(pick.event.id);
        if (!event) continue;
        const at = items.findIndex((i) => i.event?.id === pick.event.id);
        if (at >= 0) items.splice(at, 1);
        const km = Math.max(1, Math.round(pick.distanceM / 1000));
        const sponsoredItem: RecommendationItem = {
          type: 'EVENT',
          score: 1,
          reasons: [`Combina com você: #${pick.tag}`, km <= 1 ? 'Pertinho de você' : `A cerca de ${km} km de você`],
          friendsGoing: [],
          friendsEngaged: 0,
          event,
          post: null,
          sponsored: true,
          match: { tag: pick.tag, distanceKm: km },
          source: await this.sourceOf(viewerId, event, null),
        };
        items.splice(Math.min(1, items.length), 0, sponsoredItem);
      }
      if (items.length > limit) items.length = limit;
    }
    return { personalized: personalize, items };
  }
}
