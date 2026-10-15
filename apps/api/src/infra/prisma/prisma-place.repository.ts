import type { PrismaClient } from '@prisma/client';
import { isUuid } from './helpers.ts';
import { boundingBox, distanceMeters } from '../../core/geo.ts';
import { compareMatches, countTags, matchEvent, matchVenue, type EventMatch } from '../../core/explore-match.ts';
import type { EventSearchQuery, PlaceRepository } from '../../core/ports.ts';
import type { PlaceEventRecord, VenueRecord } from '../../core/types.ts';

/** Teto de linhas trazidas da caixa antes do filtro exato; evita ler a cidade inteira. */
const PREFILTER_CAP = 500;

export class PrismaPlaceRepository implements PlaceRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createVenue(v: VenueRecord): Promise<void> {
    await this.prisma.venue.create({ data: { id: v.id, name: v.name, address: v.address, category: v.category, lat: v.lat, lng: v.lng, isSample: v.isSample, ownerId: v.ownerId ?? null } });
  }

  async createEvent(e: PlaceEventRecord): Promise<void> {
    await this.prisma.placeEvent.create({
      data: {
        id: e.id, venueId: e.venueId, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt,
        kind: e.kind, isFree: e.isFree, imageUrl: e.imageUrl, tags: e.tags, isSample: e.isSample,
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

  async listVenueEvents(venueId: string) {
    if (!isUuid(venueId)) return [];
    const rows = await this.prisma.placeEvent.findMany({ where: { venueId }, orderBy: [{ startsAt: 'desc' }, { id: 'asc' }], take: 500 });
    return rows.map(toEvent);
  }

  async updateEvent(venueId: string, e: PlaceEventRecord) {
    if (!isUuid(venueId) || !isUuid(e.id)) return false;
    const res = await this.prisma.placeEvent.updateMany({
      where: { id: e.id, venueId },
      data: { title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt, kind: e.kind, isFree: e.isFree, imageUrl: e.imageUrl, tags: e.tags },
    });
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
    return out.sort(compareMatches).slice(0, q.limit);
  }

  async findEvent(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.placeEvent.findUnique({ where: { id }, include: { venue: true } });
    return r ? { event: toEvent(r), venue: toVenue(r.venue) } : undefined;
  }

  async listTags(prefix: string, from: Date, to: Date, limit: number) {
    const rows = await this.prisma.placeEvent.findMany({
      where: { endsAt: { gt: from }, startsAt: { lt: to }, tags: { isEmpty: false } },
      select: { id: true, venueId: true, title: true, description: true, startsAt: true, endsAt: true, kind: true, isFree: true, imageUrl: true, tags: true, isSample: true },
      take: PREFILTER_CAP,
    });
    return countTags(rows.map((r) => toEvent(r)), prefix, limit);
  }

  async searchVenues(text: string, center: { lat: number; lng: number } | undefined, radiusM: number, limit: number) {
    const box = center ? boundingBox(center, radiusM) : undefined;
    const rows = await this.prisma.venue.findMany({
      where: box ? { lat: { gte: box.minLat, lte: box.maxLat }, lng: { gte: box.minLng, lte: box.maxLng } } : {},
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

interface EventRow { id: string; venueId: string; title: string; description: string | null; startsAt: Date; endsAt: Date; kind: PlaceEventRecord['kind']; isFree: boolean; imageUrl: string | null; tags: string[]; isSample: boolean }
interface VenueRow { id: string; name: string; address: string | null; category: string | null; lat: number; lng: number; isSample: boolean; ownerId?: string | null }

function toEvent(r: EventRow): PlaceEventRecord {
  return { id: r.id, venueId: r.venueId, title: r.title, description: r.description, startsAt: r.startsAt, endsAt: r.endsAt, kind: r.kind, isFree: r.isFree, imageUrl: r.imageUrl, tags: [...r.tags], isSample: r.isSample };
}

function toVenue(v: VenueRow): VenueRecord {
  return { id: v.id, name: v.name, address: v.address, category: v.category, lat: v.lat, lng: v.lng, isSample: v.isSample, ownerId: v.ownerId ?? null };
}
