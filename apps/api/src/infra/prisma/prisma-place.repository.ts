import type { PrismaClient } from '@prisma/client';
import { isUuid } from './helpers.ts';
import { boundingBox, distanceMeters } from '../../core/geo.ts';
import { compactName, compareMatches, countTags, matchEvent, matchVenue, type EventMatch } from '../../core/explore-match.ts';
import type { EventSearchQuery, PlaceRepository } from '../../core/ports.ts';
import type { PlaceEventRecord, VenueHours, VenueManagerRecord, VenueProfilePatch, VenueRecord } from '../../core/types.ts';

/** Teto de linhas trazidas da caixa antes do filtro exato; evita ler a cidade inteira. */
const PREFILTER_CAP = 500;

/** Chave estrangeira violada (P2003): o local não existe mais. */
function isForeignKeyViolation(failure: unknown): boolean {
  return typeof failure === 'object' && failure !== null && (failure as { code?: unknown }).code === 'P2003';
}

export class PrismaPlaceRepository implements PlaceRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createVenue(v: VenueRecord): Promise<void> {
    await this.prisma.venue.create({
      data: {
        id: v.id, name: v.name, address: v.address, category: v.category, lat: v.lat, lng: v.lng, isSample: v.isSample, ownerId: v.ownerId ?? null,
        description: v.description ?? null, hoursJson: v.hours ? JSON.stringify(v.hours) : null, coverUrl: v.coverUrl ?? null, logoUrl: v.logoUrl ?? null, instagram: v.instagram ?? null,
        externalKey: v.externalKey ?? null, photoRef: v.photoRef ?? null, photoAuthor: v.photoAuthor ?? null, isOrganization: v.isOrganization ?? false, isUserCreated: v.isUserCreated ?? false,
      },
    });
  }

  async updateVenueProfile(venueId: string, patch: VenueProfilePatch): Promise<void> {
    if (!isUuid(venueId)) return;
    await this.prisma.venue.updateMany({
      where: { id: venueId },
      data: { name: patch.name, address: patch.address, category: patch.category, description: patch.description, hoursJson: patch.hours ? JSON.stringify(patch.hours) : null, coverUrl: patch.coverUrl, logoUrl: patch.logoUrl, instagram: patch.instagram },
    });
  }

  async setVenueCover(venueId: string, mime: string, data: Uint8Array): Promise<void> {
    if (!isUuid(venueId)) return;
    const bytes = Buffer.from(data);
    await this.prisma.venueCover.upsert({ where: { venueId }, create: { venueId, mime, data: bytes }, update: { mime, data: bytes, updatedAt: new Date() } });
  }

  async clearVenueCover(venueId: string): Promise<void> {
    if (!isUuid(venueId)) return;
    await this.prisma.venueCover.deleteMany({ where: { venueId } });
  }

  async findVenueCover(venueId: string) {
    if (!isUuid(venueId)) return undefined;
    const r = await this.prisma.venueCover.findUnique({ where: { venueId } });
    return r ? { mime: r.mime, data: new Uint8Array(r.data) } : undefined;
  }

  async setVenueLogo(venueId: string, mime: string, data: Uint8Array): Promise<void> {
    if (!isUuid(venueId)) return;
    const bytes = Buffer.from(data);
    await this.prisma.venueLogo.upsert({ where: { venueId }, create: { venueId, mime, data: bytes }, update: { mime, data: bytes, updatedAt: new Date() } });
  }

  async clearVenueLogo(venueId: string): Promise<void> {
    if (!isUuid(venueId)) return;
    await this.prisma.venueLogo.deleteMany({ where: { venueId } });
  }

  async findVenueLogo(venueId: string) {
    if (!isUuid(venueId)) return undefined;
    const r = await this.prisma.venueLogo.findUnique({ where: { venueId } });
    return r ? { mime: r.mime, data: new Uint8Array(r.data) } : undefined;
  }

  async findVenueByExternalKey(key: string) {
    const r = await this.prisma.venue.findUnique({ where: { externalKey: key } });
    return r ? toVenue(r) : undefined;
  }

  async followVenue(userId: string, venueId: string, at: Date): Promise<void> {
    if (!isUuid(userId) || !isUuid(venueId)) return;
    try {
      await this.prisma.venueFollow.createMany({ data: [{ userId, venueId, createdAt: at }], skipDuplicates: true });
    } catch (failure) {
      if (!isForeignKeyViolation(failure)) throw failure; // local apagado no meio do caminho: nada a seguir
    }
  }

  async unfollowVenue(userId: string, venueId: string): Promise<void> {
    if (!isUuid(userId) || !isUuid(venueId)) return;
    await this.prisma.venueFollow.deleteMany({ where: { userId, venueId } });
  }

  async isFollowingVenue(userId: string, venueId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(venueId)) return false;
    return (await this.prisma.venueFollow.count({ where: { userId, venueId } })) > 0;
  }

  async countVenueFollowers(venueId: string): Promise<number> {
    if (!isUuid(venueId)) return 0;
    return this.prisma.venueFollow.count({ where: { venueId } });
  }

  async setVenueNotify(userId: string, venueId: string, notify: boolean): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(venueId)) return false;
    const res = await this.prisma.venueFollow.updateMany({ where: { userId, venueId }, data: { notify } });
    return res.count > 0;
  }

  async isVenueNotifyOn(userId: string, venueId: string): Promise<boolean> {
    if (!isUuid(userId) || !isUuid(venueId)) return false;
    return (await this.prisma.venueFollow.count({ where: { userId, venueId, notify: true } })) > 0;
  }

  async listVenueNotifyFollowers(venueId: string): Promise<string[]> {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.venueFollow.findMany({ where: { venueId, notify: true }, select: { userId: true }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => r.userId);
  }

  async rateVenue(userId: string, venueId: string, stars: number, at: Date): Promise<void> {
    if (!isUuid(userId) || !isUuid(venueId)) return;
    try {
      await this.prisma.venueRating.upsert({
        where: { userId_venueId: { userId, venueId } },
        create: { userId, venueId, stars, createdAt: at, updatedAt: at },
        update: { stars, updatedAt: at },
      });
    } catch (failure) {
      if (!isForeignKeyViolation(failure)) throw failure;
    }
  }

  async venueCheckinCode(venueId: string): Promise<string | undefined> {
    if (!isUuid(venueId)) return undefined;
    return (await this.prisma.venueCheckinCode.findUnique({ where: { venueId }, select: { code: true } }))?.code;
  }

  async setVenueCheckinCode(venueId: string, code: string, at: Date): Promise<void> {
    if (!isUuid(venueId)) return;
    try {
      await this.prisma.venueCheckinCode.upsert({ where: { venueId }, create: { venueId, code, updatedAt: at }, update: { code, updatedAt: at } });
    } catch (failure) {
      if (!isForeignKeyViolation(failure)) throw failure;
    }
  }

  async addVenueCheckin(checkin: { id: string; venueId: string; userId: string; createdAt: Date }): Promise<void> {
    if (!isUuid(checkin.venueId) || !isUuid(checkin.userId)) return;
    try {
      await this.prisma.venueCheckin.create({ data: { id: checkin.id, venueId: checkin.venueId, userId: checkin.userId, createdAt: checkin.createdAt } });
    } catch (failure) {
      if (!isForeignKeyViolation(failure)) throw failure;
    }
  }

  async lastVenueCheckin(venueId: string, userId: string): Promise<Date | undefined> {
    if (!isUuid(venueId) || !isUuid(userId)) return undefined;
    return (await this.prisma.venueCheckin.findFirst({ where: { venueId, userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt;
  }

  async countVenueCheckinsByUser(venueId: string): Promise<{ userId: string; count: number }[]> {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.venueCheckin.groupBy({ by: ['userId'], where: { venueId }, _count: { _all: true } });
    return rows.map((r) => ({ userId: r.userId, count: r._count._all }));
  }

  async clearVenueRating(userId: string, venueId: string): Promise<void> {
    if (!isUuid(userId) || !isUuid(venueId)) return;
    await this.prisma.venueRating.deleteMany({ where: { userId, venueId } });
  }

  async venueRating(venueId: string, userId: string): Promise<{ count: number; sum: number; mine: number | null }> {
    if (!isUuid(venueId)) return { count: 0, sum: 0, mine: null };
    const agg = await this.prisma.venueRating.aggregate({ where: { venueId }, _count: { _all: true }, _sum: { stars: true } });
    const mine = isUuid(userId) ? await this.prisma.venueRating.findUnique({ where: { userId_venueId: { userId, venueId } }, select: { stars: true } }) : null;
    return { count: agg._count._all, sum: agg._sum.stars ?? 0, mine: mine?.stars ?? null };
  }

  async listFollowedVenueIds(userId: string): Promise<string[]> {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.venueFollow.findMany({ where: { userId }, select: { venueId: true } });
    return rows.map((r) => r.venueId);
  }

  async createEvent(e: PlaceEventRecord): Promise<void> {
    await this.prisma.placeEvent.create({
      data: {
        id: e.id, venueId: e.venueId, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt,
        kind: e.kind, isFree: e.isFree, imageUrl: e.imageUrl, tags: e.tags, ticketUrl: e.ticketUrl ?? null, isSample: e.isSample,
      },
    });
  }

  async findVenue(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.venue.findUnique({ where: { id } });
    return r ? toVenue(r) : undefined;
  }

  async listVenuesByOwner(ownerId: string) {
    const rows = await this.prisma.venue.findMany({ where: { ownerId }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(toVenue);
  }

  async listVenueManagers(venueId: string) {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.venueManager.findMany({ where: { venueId }, orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }] });
    return rows.map(toManager);
  }

  async findVenueManager(venueId: string, userId: string) {
    if (!isUuid(venueId) || !isUuid(userId)) return undefined;
    const r = await this.prisma.venueManager.findUnique({ where: { venueId_userId: { venueId, userId } } });
    return r ? toManager(r) : undefined;
  }

  async saveVenueManager(m: VenueManagerRecord) {
    const data = { status: m.status, invitedById: m.invitedById, acceptedAt: m.acceptedAt };
    await this.prisma.venueManager.upsert({
      where: { venueId_userId: { venueId: m.venueId, userId: m.userId } },
      create: { venueId: m.venueId, userId: m.userId, createdAt: m.createdAt, ...data },
      update: data,
    });
  }

  async deleteVenueManager(venueId: string, userId: string) {
    if (!isUuid(venueId) || !isUuid(userId)) return false;
    const res = await this.prisma.venueManager.deleteMany({ where: { venueId, userId } });
    return res.count > 0;
  }

  async listVenuesManagedBy(userId: string) {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.venue.findMany({ where: { managers: { some: { userId, status: 'ACCEPTED' } } }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    return rows.map(toVenue);
  }

  async listVenueManagerInvites(userId: string) {
    if (!isUuid(userId)) return [];
    const rows = await this.prisma.venueManager.findMany({ where: { userId, status: 'PENDING' }, include: { venue: true }, orderBy: [{ createdAt: 'desc' }, { venueId: 'asc' }] });
    return rows.map((r) => ({ venue: toVenue(r.venue), record: toManager(r) }));
  }

  async listVenueEvents(venueId: string) {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.placeEvent.findMany({ where: { venueId }, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }], take: 500 });
    return rows.map(toEvent);
  }

  async updateEvent(venueId: string, e: PlaceEventRecord) {
    if (!isUuid(venueId) || !isUuid(e.id)) return false;
    const res = await this.prisma.placeEvent.updateMany({
      where: { id: e.id, venueId },
      data: { title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt, kind: e.kind, isFree: e.isFree, imageUrl: e.imageUrl, tags: e.tags, ticketUrl: e.ticketUrl ?? null },
    });
    return res.count > 0;
  }

  async setEventPostponed(venueId: string, eventId: string, at: Date | null) {
    if (!isUuid(venueId) || !isUuid(eventId)) return false;
    const res = await this.prisma.placeEvent.updateMany({ where: { id: eventId, venueId }, data: { postponedAt: at } });
    return res.count > 0;
  }

  async deleteEvent(venueId: string, eventId: string) {
    if (!isUuid(venueId) || !isUuid(eventId)) return false;
    const res = await this.prisma.placeEvent.deleteMany({ where: { id: eventId, venueId } });
    return res.count > 0;
  }

  async setVenueOwner(venueId: string, ownerId: string | null) {
    await this.prisma.venue.updateMany({ where: { id: venueId }, data: { ownerId } });
  }

  async findEventsNear(center: { lat: number; lng: number }, radiusM: number, from: Date, to: Date, limit: number) {
    const box = boundingBox(center, radiusM);
    const rows = await this.prisma.placeEvent.findMany({
      where: {
        endsAt: { gt: from },
        startsAt: { lt: to },
        venue: { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } },
      },
      include: { venue: true },
      orderBy: { startsAt: 'asc' },
      take: PREFILTER_CAP,
    });
    const found = rows
      .map((r) => ({
        d: distanceMeters(center, r.venue),
        event: toEvent(r),
        venue: toVenue(r.venue),
      }))
      .filter((r) => r.d <= radiusM);
    found.sort((a, b) => a.d - b.d || a.event.startsAt.getTime() - b.event.startsAt.getTime() || (a.event.id < b.event.id ? -1 : 1));
    return found.slice(0, limit).map(({ event, venue }) => ({ event, venue }));
  }

  async searchEvents(q: EventSearchQuery) {
    const box = q.center && q.radiusM !== undefined ? boundingBox(q.center, q.radiusM) : undefined;
    const rows = await this.prisma.placeEvent.findMany({
      where: {
        endsAt: { gt: q.from },
        startsAt: { lt: q.to },
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.freeOnly ? { isFree: true } : {}),
        ...(q.venueIds ? { venueId: { in: q.venueIds.filter(isUuid) } } : {}),
        ...(box ? { venue: { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } } } : {}),
      },
      include: { venue: true },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      take: PREFILTER_CAP,
    });
    const out: EventMatch[] = [];
    for (const r of rows) {
      const m = matchEvent(toEvent(r), toVenue(r.venue), q);
      if (m) out.push(m);
    }
    return out.sort(compareMatches).slice(q.offset ?? 0, (q.offset ?? 0) + q.limit);
  }

  async findEvent(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.placeEvent.findUnique({ where: { id }, include: { venue: true } });
    return r ? { event: toEvent(r), venue: toVenue(r.venue) } : undefined;
  }

  async setEventCover(eventId: string, mime: string, data: Uint8Array): Promise<void> {
    if (!isUuid(eventId)) return;
    const bytes = Buffer.from(data);
    await this.prisma.placeEventCover.upsert({ where: { eventId }, create: { eventId, mime, data: bytes }, update: { mime, data: bytes, updatedAt: new Date() } });
  }

  async clearEventCover(eventId: string): Promise<void> {
    if (!isUuid(eventId)) return;
    await this.prisma.placeEventCover.deleteMany({ where: { eventId } });
  }

  async findEventCover(eventId: string) {
    if (!isUuid(eventId)) return undefined;
    const r = await this.prisma.placeEventCover.findUnique({ where: { eventId }, select: { mime: true, data: true } });
    return r ? { mime: r.mime, data: new Uint8Array(r.data) } : undefined;
  }

  async listTags(prefix: string, from: Date, to: Date, limit: number) {
    const rows = await this.prisma.placeEvent.findMany({
      where: { endsAt: { gt: from }, startsAt: { lt: to }, tags: { isEmpty: false } },
      select: { id: true, venueId: true, title: true, description: true, startsAt: true, endsAt: true, kind: true, isFree: true, imageUrl: true, tags: true, ticketUrl: true, isSample: true },
      take: PREFILTER_CAP,
    });
    return countTags(rows.map((r) => toEvent(r)), prefix, limit);
  }

  async searchVenues(text: string, center: { lat: number; lng: number } | undefined, radiusM: number, limit: number) {
    const box = center && radiusM > 0 ? boundingBox(center, radiusM) : undefined;
    // O nome é filtrado no banco (sem acento, maiúscula, pontuação e espaços): antes vinham só os 500 primeiros locais
    // e o filtro era feito depois, então locais além deles (ex.: "What's Bar" em Santos) nunca apareciam.
    // Com posição, os 500 que passam são os mais perto dela: um nome comum ("Bar do Zé") tem centenas de homônimos
    // pelo país e o da esquina não pode ficar de fora por acaso.
    const needle = compactName(text);
    const cosLat = center ? Math.max(Math.cos((center.lat * Math.PI) / 180), 0.2) : 1;
    const ids = needle
      ? (
          center
            ? await this.prisma.$queryRaw<{ id: string }[]>`
                SELECT id FROM "Venue"
                WHERE regexp_replace(translate(lower(name), 'áàâãäåéèêëíìîïóòôõöúùûüçñý', 'aaaaaaeeeeiiiiooooouuuucny'), '[^a-z0-9]', '', 'g') LIKE ${`%${needle}%`}
                ORDER BY power(lat - ${center.lat}, 2) + power((lng - ${center.lng}) * ${cosLat}, 2)
                LIMIT ${PREFILTER_CAP}`
            : await this.prisma.$queryRaw<{ id: string }[]>`
                SELECT id FROM "Venue"
                WHERE regexp_replace(translate(lower(name), 'áàâãäåéèêëíìîïóòôõöúùûüçñý', 'aaaaaaeeeeiiiiooooouuuucny'), '[^a-z0-9]', '', 'g') LIKE ${`%${needle}%`}
                LIMIT ${PREFILTER_CAP}`
        ).map((r) => r.id)
      : undefined;
    if (ids && ids.length === 0) return [];
    const rows = await this.prisma.venue.findMany({
      // Organização ou local criado do zero sem dono (pedido em análise ou recusado) fica fora das buscas.
      where: { AND: [ids ? { id: { in: ids } } : {}, box ? { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } } : {}, { OR: [{ isOrganization: false, isUserCreated: false }, { ownerId: { not: null } }] }] },
      orderBy: { id: 'asc' },
      take: PREFILTER_CAP,
    });
    const out: { venue: VenueRecord; distanceM: number | null }[] = [];
    for (const r of rows) {
      const m = matchVenue(toVenue(r), text, center, radiusM);
      if (m) out.push(m);
    }
    return out.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) || (a.venue.id < b.venue.id ? -1 : 1)).slice(0, limit);
  }
}

interface EventRow { id: string; venueId: string; title: string; description: string | null; startsAt: Date; endsAt: Date; kind: PlaceEventRecord['kind']; isFree: boolean; imageUrl: string | null; tags: string[]; ticketUrl: string | null; postponedAt?: Date | null; isSample: boolean }
interface VenueRow { id: string; name: string; address: string | null; category: string | null; lat: number; lng: number; isSample: boolean; ownerId?: string | null; description?: string | null; hoursJson?: string | null; coverUrl?: string | null; logoUrl?: string | null; instagram?: string | null; externalKey?: string | null; photoRef?: string | null; photoAuthor?: string | null; isOrganization?: boolean; isUserCreated?: boolean }

function toEvent(r: EventRow): PlaceEventRecord {
  return { id: r.id, venueId: r.venueId, title: r.title, description: r.description, startsAt: r.startsAt, endsAt: r.endsAt, kind: r.kind, isFree: r.isFree, imageUrl: r.imageUrl, tags: [...r.tags], ticketUrl: r.ticketUrl, postponedAt: r.postponedAt ?? null, isSample: r.isSample };
}

function toVenue(v: VenueRow): VenueRecord {
  return {
    id: v.id, name: v.name, address: v.address, category: v.category, lat: v.lat, lng: v.lng, isSample: v.isSample, ownerId: v.ownerId ?? null,
    description: v.description ?? null, hours: parseHours(v.hoursJson), coverUrl: v.coverUrl ?? null, logoUrl: v.logoUrl ?? null, instagram: v.instagram ?? null, externalKey: v.externalKey ?? null, photoRef: v.photoRef ?? null, photoAuthor: v.photoAuthor ?? null, isOrganization: v.isOrganization ?? false, isUserCreated: v.isUserCreated ?? false,
  };
}

function parseHours(json: string | null | undefined): VenueHours | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length === 7 ? (parsed as VenueHours) : null;
  } catch {
    return null;
  }
}

function toManager(r: { venueId: string; userId: string; status: 'PENDING' | 'ACCEPTED'; invitedById: string; createdAt: Date; acceptedAt: Date | null }): VenueManagerRecord {
  return { venueId: r.venueId, userId: r.userId, status: r.status, invitedById: r.invitedById, createdAt: r.createdAt, acceptedAt: r.acceptedAt };
}
