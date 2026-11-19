import { ageOn, ADULT_AGE } from './age-service.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { InterestService } from './interest-service.ts';
import { POST_VIDEO_MAX_BYTES, parseChatMedia } from './media.ts';
import type { CoreDeps } from './ports.ts';
import type { Actor, EventKind, Page, PublicProfile, ReportResolution, VenueRecord } from './types.ts';
import { POST_REPORT_REASONS, REPORT_RESOLUTIONS, toPublicProfile } from './types.ts';
import type { PostReportReason } from './types.ts';
import {
  ROLLING_LIMIT,
  ROLLING_RADIUS_KM,
  VENUE_STORY_HOURS,
  VENUE_STORY_MAX_LIVE,
  VENUE_STORY_REPORT_DETAILS_MAX,
  VENUE_STORY_SUSPEND_DAYS,
  VENUE_STORY_SUSPEND_REPORTERS,
  approximate,
  isAlcoholVenue,
} from './venue-story.ts';
import type { VenueStoryMeta, VenueStoryReportRecord } from './venue-story.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FRIENDS_SHOWN = 3;

export interface VenueStoryItemView {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  createdAt: string;
  expiresAt: string;
}

export interface VenueStoryVenueView {
  id: string;
  name: string;
  category: string | null;
  logoUrl: string | null;
}

/** Os stories de um local, para a faixa da Home e o visualizador. */
export interface VenueStoryGroupView {
  venue: VenueStoryVenueView;
  items: VenueStoryItemView[];
}

/** Um item da faixa "Rolando agora": um local com story no ar e/ou evento em andamento. */
export interface RollingNowItem {
  venue: VenueStoryVenueView;
  stories: VenueStoryItemView[];
  event: { id: string; title: string; kind: EventKind; startsAt: string; endsAt: string; isFree: boolean; goingCount: number } | null;
  /** Em metros, arredondada a 100 m, ou null sem posição. */
  distanceM: number | null;
  /** O evento bate com um interesse seu. */
  interest: boolean;
  friendsGoingCount: number;
  friendsGoing: PublicProfile[];
}

/** O painel do local: o que está no ar e se a publicação está suspensa por denúncias. */
export interface VenueStoryOwnerView {
  suspended: boolean;
  items: VenueStoryItemView[];
}

export interface VenueStorySettingsView {
  hideVenueStories: boolean;
  mutedVenues: { id: string; name: string }[];
}

export interface AdminVenueStoryReportRow {
  id: string;
  reason: PostReportReason;
  details: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolution: ReportResolution | null;
  resolutionNote: string | null;
  reporter: { id: string; username: string };
  story: { id: string; kind: 'IMAGE' | 'VIDEO'; venueId: string; venueName: string | null; author: { id: string; username: string } | null; createdAt: string; expiresAt: string };
  /** Pessoas diferentes com denúncia aberta contra o local (a partir de tantas, a publicação é suspensa). */
  venueOpenReporters: number;
}

function optionalText(value: unknown, max: number, field: string, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError('Dados inválidos', { [field]: `${label} inválido` });
  const text = value.trim();
  if (text === '') return null;
  if (Array.from(text).length > max) throw validationError('Dados inválidos', { [field]: `${label} pode ter até ${max} caracteres` });
  return text;
}

function parsePage(query: { limit?: unknown; offset?: unknown }): Page {
  const num = (v: unknown, fallback: number) => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : fallback);
  return { limit: Math.min(Math.max(num(query.limit, 30), 1), 100), offset: num(query.offset, 0) };
}

const itemView = (s: VenueStoryMeta): VenueStoryItemView => ({ id: s.id, kind: s.video ? 'VIDEO' : 'IMAGE', createdAt: s.createdAt.toISOString(), expiresAt: s.expiresAt.toISOString() });
const venueView = (v: VenueRecord): VenueStoryVenueView => ({ id: v.id, name: v.name, category: v.category, logoUrl: v.logoUrl ?? null });

/** Quem vê: o que decide se um local (e os stories dele) aparece. */
interface ViewerContext {
  id: string;
  adult: boolean;
  hideAll: boolean;
  muted: Set<string>;
  related: Set<string>;
  activeOwners: Map<string, boolean>;
}

/**
 * Stories públicos de locais verificados (com responsável). Quem segue o local vê na Home; no Explorar a faixa
 * "Rolando agora" junta os stories de locais da região e os eventos em andamento. Pessoas não publicam stories públicos.
 * Privacidade: quem vê pode silenciar o local, desligar tudo, denunciar; bloqueio some com o local; menores não veem
 * locais de bebida alcoólica; a posição só vale na consulta (arredondada, nunca gravada).
 */
export class VenueStoryService {
  private readonly deps: CoreDeps;
  private readonly interests: InterestService;

  constructor(deps: CoreDeps, interests: InterestService) {
    this.deps = deps;
    this.interests = interests;
  }

  private async viewer(viewerId: string): Promise<ViewerContext> {
    const { venueStories, users, blocks } = this.deps;
    const [user, prefs, muted, related] = await Promise.all([users.findById(viewerId), venueStories.getPrefs(viewerId), venueStories.listMuted(viewerId), blocks.listRelatedIds(viewerId)]);
    const adult = user?.birthDate ? ageOn(user.birthDate, this.deps.clock.now()) >= ADULT_AGE : false;
    return { id: viewerId, adult, hideAll: prefs.hideAll, muted: new Set(muted), related: new Set(related), activeOwners: new Map() };
  }

  /** O local pode aparecer para quem vê: não silenciado, sem bloqueio com o responsável, e sem bebida alcoólica para menor. */
  private async venueVisible(ctx: ViewerContext, venue: VenueRecord): Promise<boolean> {
    if (ctx.muted.has(venue.id)) return false;
    if (!ctx.adult && isAlcoholVenue(venue.category)) return false;
    if (venue.ownerId) {
      if (ctx.related.has(venue.ownerId)) return false;
      let active = ctx.activeOwners.get(venue.ownerId);
      if (active === undefined) {
        active = (await this.deps.users.findById(venue.ownerId))?.status === 'ACTIVE';
        ctx.activeOwners.set(venue.ownerId, active);
      }
      if (!active) return false;
    }
    return true;
  }

  /** Stories no ar destes locais que a pessoa pode ver (só de local verificado, sem os que ela denunciou). */
  private async visibleStories(ctx: ViewerContext, venues: Map<string, VenueRecord>): Promise<Map<string, VenueStoryMeta[]>> {
    const out = new Map<string, VenueStoryMeta[]>();
    if (ctx.hideAll || venues.size === 0) return out;
    const all = await this.deps.venueStories.listLive([...venues.keys()], this.deps.clock.now());
    const reported = await this.deps.venueStories.reportedIds(ctx.id, all.map((s) => s.id));
    for (const s of all) {
      const venue = venues.get(s.venueId);
      if (!venue || !venue.ownerId || reported.has(s.id) || !(await this.venueVisible(ctx, venue))) continue;
      out.set(s.venueId, [...(out.get(s.venueId) ?? []), s]);
    }
    return out;
  }

  /** Home: os stories dos locais que você segue, o local com story mais novo primeiro. */
  async home(viewerId: string): Promise<VenueStoryGroupView[]> {
    const ctx = await this.viewer(viewerId);
    if (ctx.hideAll) return [];
    const venues = new Map<string, VenueRecord>();
    for (const id of await this.deps.places.listFollowedVenueIds(viewerId)) {
      const venue = await this.deps.places.findVenue(id);
      if (venue) venues.set(id, venue);
    }
    const stories = await this.visibleStories(ctx, venues);
    const groups = [...stories.entries()].map(([venueId, rows]) => ({ venue: venueView(venues.get(venueId)!), items: rows.map(itemView), last: rows[rows.length - 1]!.createdAt.getTime() }));
    return groups.sort((a, b) => b.last - a.last || (a.venue.id < b.venue.id ? -1 : 1)).map(({ last: _last, ...g }) => g);
  }

  /**
   * Explorar, "Rolando agora": stories de locais verificados da região e eventos em andamento, juntos por local.
   * A posição vem na consulta (ou da região aproximada que a pessoa já salvou), é arredondada e não é gravada.
   * Ordem: eventos que combinam com seus interesses e com amigos confirmados sobem; depois, o mais perto.
   */
  async rollingNow(viewerId: string, input: { lat?: unknown; lng?: unknown; radiusKm?: unknown }): Promise<RollingNowItem[]> {
    const { places, eventRoom, follows, clock } = this.deps;
    const now = clock.now();
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : undefined);
    const lat = num(input.lat);
    const lng = num(input.lng);
    if ((lat === undefined) !== (lng === undefined)) throw validationError('Posição incompleta', { lat: 'Envie lat e lng juntos' });
    if (lat !== undefined && lng !== undefined && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) throw validationError('Posição inválida', { lat: 'Coordenadas fora do intervalo' });
    const saved = lat === undefined ? await this.deps.regions.find(viewerId) : undefined;
    const raw = lat !== undefined && lng !== undefined ? { lat, lng } : saved ? { lat: saved.lat, lng: saved.lng } : undefined;
    const center = raw ? { lat: approximate(raw.lat), lng: approximate(raw.lng) } : undefined;
    const radiusKm = num(input.radiusKm) ?? ROLLING_RADIUS_KM;
    if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 50) throw validationError('Raio inválido', { radiusKm: 'Entre 1 e 50 km' });
    const radiusM = Math.round(radiusKm * 1000);

    const ctx = await this.viewer(viewerId);
    const liveEvents = await places.searchEvents({ ...(center ? { center, radiusM } : {}), from: now, to: new Date(now.getTime() + 1), limit: 60 });
    const nearVenues = await places.searchVenues('', center, radiusM, 60);
    const venues = new Map<string, VenueRecord>();
    const distance = new Map<string, number | null>();
    for (const { venue, distanceM } of nearVenues) {
      venues.set(venue.id, venue);
      distance.set(venue.id, distanceM);
    }
    for (const { venue, distanceM } of liveEvents) {
      venues.set(venue.id, venue);
      distance.set(venue.id, distanceM);
    }
    const stories = await this.visibleStories(ctx, venues);
    const eventByVenue = new Map<string, (typeof liveEvents)[number]>();
    for (const row of liveEvents) {
      const current = eventByVenue.get(row.venue.id);
      if (!current || row.event.endsAt.getTime() < current.event.endsAt.getTime()) eventByVenue.set(row.venue.id, row);
    }

    const mine = new Set((await this.interests.interestsOf(viewerId, now)).map((i) => i.tag));
    const friends = new Set((await follows.listFriendIds(viewerId)).filter((id) => !ctx.related.has(id)));
    const items: (RollingNowItem & { score: number })[] = [];
    for (const venueId of new Set([...stories.keys(), ...eventByVenue.keys()])) {
      const venue = venues.get(venueId)!;
      if (!(await this.venueVisible(ctx, venue))) continue;
      const rows = stories.get(venueId) ?? [];
      const found = eventByVenue.get(venueId);
      let friendsGoing: PublicProfile[] = [];
      let friendsGoingCount = 0;
      let goingCount = 0;
      if (found) {
        const going = await eventRoom.listGoing({ source: 'PLACE', id: found.event.id });
        goingCount = going.length;
        const ids = going.map((g) => g.userId).filter((id) => friends.has(id));
        friendsGoingCount = ids.length;
        friendsGoing = (await this.deps.users.findProfilesByIds(ids.slice(0, FRIENDS_SHOWN))).map(toPublicProfile);
      }
      const interest = found ? found.event.tags.some((tag) => mine.has(tag)) : false;
      const d = distance.get(venueId) ?? null;
      const proximity = d === null ? 0 : Math.max(0, 1 - d / radiusM);
      const score = proximity * 3 + (interest ? 2 : 0) + Math.min(friendsGoingCount, 3) * 1.5 + (rows.length > 0 ? 0.5 : 0);
      items.push({
        venue: venueView(venue),
        stories: rows.map(itemView),
        event: found ? { id: found.event.id, title: found.event.title, kind: found.event.kind, startsAt: found.event.startsAt.toISOString(), endsAt: found.event.endsAt.toISOString(), isFree: found.event.isFree, goingCount } : null,
        distanceM: d === null ? null : Math.round(d / 100) * 100,
        interest,
        friendsGoingCount,
        friendsGoing,
        score,
      });
    }
    return items
      .sort((a, b) => b.score - a.score || (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) || (a.venue.id < b.venue.id ? -1 : 1))
      .slice(0, ROLLING_LIMIT)
      .map(({ score: _score, ...item }) => item);
  }

  /** A publicação do local está suspensa: várias pessoas diferentes denunciaram e a gestão ainda não decidiu. */
  async isSuspended(venueId: string): Promise<boolean> {
    const since = new Date(this.deps.clock.now().getTime() - VENUE_STORY_SUSPEND_DAYS * DAY);
    return (await this.deps.venueStories.countOpenReporters(venueId, since)) >= VENUE_STORY_SUSPEND_REPORTERS;
  }

  /** Quem não é responsável recebe "não encontrado", como no resto do painel do local. */
  private async ownedOrThrow(userId: string, venueId: unknown): Promise<VenueRecord> {
    const venue = typeof venueId === 'string' && venueId !== '' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue || venue.ownerId !== userId) throw notFound('Local não encontrado');
    return venue;
  }

  async ownerList(userId: string, venueId: unknown): Promise<VenueStoryOwnerView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    const rows = await this.deps.venueStories.listLive([venue.id], this.deps.clock.now());
    return { suspended: await this.isSuspended(venue.id), items: rows.map(itemView) };
  }

  /** O responsável publica foto (até 2 MB) ou vídeo (até 60 MB). Dura 24 h. */
  async publish(userId: string, venueId: unknown, contentType: unknown, bytes: unknown): Promise<VenueStoryItemView> {
    const venue = await this.ownedOrThrow(userId, venueId);
    if (await this.isSuspended(venue.id)) throw forbidden('A publicação de flashes deste local está suspensa até a gestão analisar as denúncias');
    const now = this.deps.clock.now();
    if ((await this.deps.venueStories.listLive([venue.id], now)).length >= VENUE_STORY_MAX_LIVE) throw validationError('Muitos flashes', { media: `O local já tem ${VENUE_STORY_MAX_LIVE} flashes no ar` });
    const media = parseChatMedia(contentType, bytes, POST_VIDEO_MAX_BYTES);
    const record = { id: this.deps.ids.next(), venueId: venue.id, authorId: userId, mime: media.mime, video: media.kind === 'VIDEO', data: media.data, createdAt: now, expiresAt: new Date(now.getTime() + VENUE_STORY_HOURS * HOUR) };
    await this.deps.venueStories.add(record);
    return itemView(record);
  }

  async remove(userId: string, venueId: unknown, storyId: unknown): Promise<{ deleted: true }> {
    const venue = await this.ownedOrThrow(userId, venueId);
    const story = typeof storyId === 'string' && storyId.length <= 64 ? await this.deps.venueStories.find(storyId) : undefined;
    if (!story || story.venueId !== venue.id) throw notFound('Flash não encontrado');
    await this.deps.venueStories.delete(story.id);
    return { deleted: true };
  }

  /** Denuncia um story de local. Fica para a gestão e quem denunciou deixa de vê-lo. */
  async report(viewerId: string, storyId: unknown, reason: unknown, details?: unknown): Promise<{ reported: true }> {
    const story = typeof storyId === 'string' && storyId.length <= 64 ? await this.deps.venueStories.find(storyId) : undefined;
    if (!story || story.expiresAt.getTime() <= this.deps.clock.now().getTime()) throw notFound('Flash não encontrado');
    if (story.authorId === viewerId) throw forbidden('Este flash é do seu local: apague-o se não quiser mais');
    if (typeof reason !== 'string' || !(POST_REPORT_REASONS as readonly string[]).includes(reason)) throw validationError('Motivo inválido', { reason: 'Escolha um motivo da lista' });
    const text = optionalText(details, VENUE_STORY_REPORT_DETAILS_MAX, 'details', 'Detalhes');
    await this.deps.venueStories.report({ id: this.deps.ids.next(), storyId: story.id, reporterId: viewerId, reason: reason as PostReportReason, details: text, createdAt: this.deps.clock.now(), resolvedAt: null, resolution: null, resolutionNote: null });
    return { reported: true };
  }

  /** "Não tenho interesse": o local deixa de aparecer na Home e no Explorar (stories e eventos da faixa). */
  async setMuted(viewerId: string, venueId: unknown, muted: unknown): Promise<{ muted: boolean }> {
    if (typeof muted !== 'boolean') throw validationError('Confira os dados', { muted: 'Use verdadeiro ou falso' });
    const venue = typeof venueId === 'string' && venueId !== '' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue) throw notFound('Local não encontrado');
    await this.deps.venueStories.setMuted(viewerId, venue.id, muted);
    return { muted };
  }

  async settings(viewerId: string): Promise<VenueStorySettingsView> {
    const [prefs, muted] = await Promise.all([this.deps.venueStories.getPrefs(viewerId), this.deps.venueStories.listMuted(viewerId)]);
    const mutedVenues: { id: string; name: string }[] = [];
    for (const id of muted) {
      const venue = await this.deps.places.findVenue(id);
      if (venue) mutedVenues.push({ id, name: venue.name });
    }
    return { hideVenueStories: prefs.hideAll, mutedVenues };
  }

  async setSettings(viewerId: string, input: { hideVenueStories?: unknown }): Promise<VenueStorySettingsView> {
    if (typeof input.hideVenueStories !== 'boolean') throw validationError('Confira os dados', { hideVenueStories: 'Use verdadeiro ou falso' });
    await this.deps.venueStories.setPrefs(viewerId, { hideAll: input.hideVenueStories });
    return this.settings(viewerId);
  }

  /** A mídia para <img>/<video>. Pública (o id é aleatório), só enquanto o story está no ar. */
  async media(storyId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof storyId !== 'string' || storyId === '' || storyId.length > 64) return undefined;
    const media = await this.deps.venueStories.findMedia(storyId);
    if (!media || media.expiresAt.getTime() <= this.deps.clock.now().getTime()) return undefined;
    return { mime: media.mime, data: media.data };
  }

  // ---------- Gestão ----------

  private assertAdmin(actor: Actor): void {
    if (actor.role !== 'ADMIN') throw forbidden('Acesso restrito a administradores');
  }

  async adminReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<{ items: AdminVenueStoryReportRow[]; limit: number; offset: number; hasMore: boolean }> {
    this.assertAdmin(actor);
    const page = parsePage(query);
    const rows = await this.deps.venueStories.listReports(query.status !== 'resolved', { limit: page.limit + 1, offset: page.offset });
    const since = new Date(this.deps.clock.now().getTime() - VENUE_STORY_SUSPEND_DAYS * DAY);
    const items: AdminVenueStoryReportRow[] = [];
    for (const r of rows.slice(0, page.limit)) {
      const story = await this.deps.venueStories.find(r.storyId);
      if (!story) continue;
      const venue = await this.deps.places.findVenue(story.venueId);
      const [reporter] = await this.deps.users.findProfilesByIds([r.reporterId]);
      const [author] = await this.deps.users.findProfilesByIds([story.authorId]);
      items.push({
        id: r.id,
        reason: r.reason,
        details: r.details,
        createdAt: r.createdAt.toISOString(),
        resolvedAt: r.resolvedAt?.toISOString() ?? null,
        resolution: r.resolution,
        resolutionNote: r.resolutionNote,
        reporter: { id: r.reporterId, username: reporter?.username ?? '—' },
        story: { id: story.id, kind: story.video ? 'VIDEO' : 'IMAGE', venueId: story.venueId, venueName: venue?.name ?? null, author: author ? { id: author.userId, username: author.username } : null, createdAt: story.createdAt.toISOString(), expiresAt: story.expiresAt.toISOString() },
        venueOpenReporters: await this.deps.venueStories.countOpenReporters(story.venueId, since),
      });
    }
    return { items, limit: page.limit, offset: page.offset, hasMore: rows.length > page.limit };
  }

  /** Decide a denúncia. Decidida, ela deixa de contar para a suspensão do local. */
  async adminResolve(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    if (typeof resolution !== 'string' || !(REPORT_RESOLUTIONS as readonly string[]).includes(resolution)) throw validationError('Decisão inválida', { resolution: 'Use DISMISSED ou ACTIONED' });
    const text = optionalText(note, 500, 'note', 'Nota');
    const report: VenueStoryReportRecord | undefined = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.venueStories.findReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.venueStories.resolveReport(report.id, actor.userId, resolution as ReportResolution, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.deps.admin.addAudit({ id: this.deps.ids.next(), adminId: actor.userId, action: resolution === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', targetType: 'STORY_REPORT', targetId: report.id, note: text, createdAt: this.deps.clock.now() });
    return { resolved: true };
  }

  async adminRemove(actor: Actor, storyId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const text = optionalText(note, 500, 'note', 'Nota');
    if (text === null) throw validationError('Informe o motivo', { note: 'Informe o motivo' });
    if (typeof storyId !== 'string' || storyId.length > 64 || !(await this.deps.venueStories.delete(storyId))) throw notFound('Flash não encontrado');
    await this.deps.admin.addAudit({ id: this.deps.ids.next(), adminId: actor.userId, action: 'STORY_REMOVED', targetType: 'STORY', targetId: storyId, note: text, createdAt: this.deps.clock.now() });
    return { deleted: true };
  }

  async adminMedia(actor: Actor, storyId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    this.assertAdmin(actor);
    if (typeof storyId !== 'string' || storyId === '' || storyId.length > 64) return undefined;
    const media = await this.deps.venueStories.findMedia(storyId);
    return media ? { mime: media.mime, data: media.data } : undefined;
  }
}
