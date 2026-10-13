import type { PrismaClient } from '@prisma/client';
import { boundingBox, distanceMeters } from '../../core/geo.ts';
import type { PlaceRepository } from '../../core/ports.ts';
import type { PlaceEventRecord, VenueRecord } from '../../core/types.ts';

/** Teto de linhas trazidas da caixa antes do filtro exato; evita ler a cidade inteira. */
const PREFILTER_CAP = 500;

export class PrismaPlaceRepository implements PlaceRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async createVenue(v: VenueRecord): Promise<void> {
    await this.prisma.venue.create({ data: { id: v.id, name: v.name, address: v.address, category: v.category, lat: v.lat, lng: v.lng, isSample: v.isSample } });
  }

  async createEvent(e: PlaceEventRecord): Promise<void> {
    await this.prisma.placeEvent.create({
      data: { id: e.id, venueId: e.venueId, title: e.title, description: e.description, startsAt: e.startsAt, endsAt: e.endsAt, isSample: e.isSample },
    });
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
        event: { id: r.id, venueId: r.venueId, title: r.title, description: r.description, startsAt: r.startsAt, endsAt: r.endsAt, isSample: r.isSample } satisfies PlaceEventRecord,
        venue: { id: r.venue.id, name: r.venue.name, address: r.venue.address, category: r.venue.category, lat: r.venue.lat, lng: r.venue.lng, isSample: r.venue.isSample } satisfies VenueRecord,
      }))
      .filter((r) => r.d <= radiusM);
    found.sort((a, b) => a.d - b.d || a.event.startsAt.getTime() - b.event.startsAt.getTime() || (a.event.id < b.event.id ? -1 : 1));
    return found.slice(0, limit).map(({ event, venue }) => ({ event, venue }));
  }
}
