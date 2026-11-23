import type { Prisma, PrismaClient } from '@prisma/client';
import type { HunterEventFields, HunterLink, HunterStore, HunterTx, HunterVenueState } from '../../core/hunter-bridge.ts';

const ENABLED_KEY = 'hunter.enabled';

const venueSelect = { id: true, name: true, address: true, lat: true, lng: true, externalKey: true, ownerId: true, claims: { select: { status: true } } } as const;
type VenueRow = Prisma.VenueGetPayload<{ select: typeof venueSelect }>;

const toState = (v: VenueRow): HunterVenueState => ({ id: v.id, name: v.name, address: v.address, lat: v.lat, lng: v.lng, externalKey: v.externalKey, ownerId: v.ownerId, claimStatuses: v.claims.map((c) => c.status) });

function txOf(tx: Prisma.TransactionClient): HunterTx {
  return {
    venue: async (id) => {
      const v = await tx.venue.findUnique({ where: { id }, select: venueSelect });
      return v ? toState(v) : undefined;
    },
    link: async (ref) => {
      const l = await tx.hunterEventLink.findUnique({ where: { ref } });
      return l ? { ref: l.ref, eventId: l.eventId, venueId: l.venueId } : undefined;
    },
    createEvent: async (eventId: string, link: HunterLink, f: HunterEventFields) => {
      await tx.placeEvent.create({
        data: { id: eventId, venueId: f.venueId, title: f.title, description: f.description, startsAt: f.startsAt, endsAt: f.endsAt, kind: f.kind, isFree: f.isFree, imageUrl: f.imageUrl, tags: f.tags, ticketUrl: f.ticketUrl, isSample: false },
      });
      await tx.hunterEventLink.create({ data: { ref: link.ref, eventId, venueId: link.venueId } });
    },
    updateEvent: async (eventId, f) => {
      await tx.placeEvent.update({ where: { id: eventId }, data: { title: f.title, description: f.description, startsAt: f.startsAt, endsAt: f.endsAt, kind: f.kind, isFree: f.isFree, imageUrl: f.imageUrl, tags: f.tags, ticketUrl: f.ticketUrl } });
    },
    deleteEvent: async (eventId) => {
      await tx.placeEvent.delete({ where: { id: eventId } });
    },
    eventsStartingBetween: async (venueId, from, to) => tx.placeEvent.findMany({ where: { venueId, startsAt: { gte: from, lt: to } }, select: { id: true, title: true } }),
  };
}

/** Armazenamento da ponte do Hunter no Postgres. Tudo do Hunter usa só este arquivo e a tabela HunterEventLink. */
export class PrismaHunterStore implements HunterStore {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async isEnabled(): Promise<boolean> {
    const s = await this.prisma.appSetting.findUnique({ where: { key: ENABLED_KEY } });
    return s?.value === 'true';
  }

  async setEnabled(enabled: boolean, adminId: string, at: Date): Promise<void> {
    await this.prisma.appSetting.upsert({
      where: { key: ENABLED_KEY },
      create: { key: ENABLED_KEY, value: String(enabled), updatedAt: at, updatedBy: adminId },
      update: { value: String(enabled), updatedAt: at, updatedBy: adminId },
    });
  }

  async venueByExternalKey(key: string): Promise<HunterVenueState | undefined> {
    const v = await this.prisma.venue.findUnique({ where: { externalKey: key }, select: venueSelect });
    return v ? toState(v) : undefined;
  }

  async searchVenues(text: string, center: { lat: number; lng: number } | undefined, radiusM: number, limit: number): Promise<HunterVenueState[]> {
    const where: Prisma.VenueWhereInput = { isSample: false, name: { contains: text, mode: 'insensitive' } };
    if (center) {
      const dLat = radiusM / 111_000;
      const dLng = radiusM / (111_000 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.2));
      where.lat = { gte: center.lat - dLat, lte: center.lat + dLat };
      where.lng = { gte: center.lng - dLng, lte: center.lng + dLng };
    }
    const rows = await this.prisma.venue.findMany({ where, select: venueSelect, take: limit });
    return rows.map(toState);
  }

  async transaction<T>(venueId: string, run: (tx: HunterTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // Trava a linha do local: uma aprovação de dono que chegue agora espera esta publicação terminar (e vale depois dela).
      await tx.$queryRaw`SELECT "id" FROM "Venue" WHERE "id" = ${venueId}::uuid FOR UPDATE`;
      return run(txOf(tx));
    });
  }

  async findLink(ref: string): Promise<(HunterLink & { eventStartsAt: Date }) | undefined> {
    const l = await this.prisma.hunterEventLink.findUnique({ where: { ref }, include: { event: { select: { startsAt: true } } } });
    return l ? { ref: l.ref, eventId: l.eventId, venueId: l.venueId, eventStartsAt: l.event.startsAt } : undefined;
  }

  async listLinks(limit: number, offset: number) {
    const [total, rows] = await Promise.all([
      this.prisma.hunterEventLink.count(),
      this.prisma.hunterEventLink.findMany({ orderBy: { createdAt: 'desc' }, take: limit, skip: offset, include: { event: { select: { title: true, startsAt: true, venue: { select: { name: true } } } } } }),
    ]);
    return { total, items: rows.map((r) => ({ ref: r.ref, eventId: r.eventId, title: r.event.title, venueId: r.venueId, venueName: r.event.venue.name, startsAt: r.event.startsAt, createdAt: r.createdAt })) };
  }

  async deleteByRefs(refs: string[]): Promise<number> {
    if (refs.length === 0) return 0;
    const links = await this.prisma.hunterEventLink.findMany({ where: { ref: { in: refs } }, select: { eventId: true } });
    const r = await this.prisma.placeEvent.deleteMany({ where: { id: { in: links.map((l) => l.eventId) } } });
    return r.count;
  }

  async allRefs(): Promise<string[]> {
    return (await this.prisma.hunterEventLink.findMany({ select: { ref: true } })).map((l) => l.ref);
  }

  async regionCells(cellDeg: number, minUsers: number) {
    const rows = await this.prisma.$queryRaw<{ lat: number; lng: number; users: bigint }[]>`
      SELECT floor("lat" / ${cellDeg}) * ${cellDeg} + ${cellDeg / 2} AS lat, floor("lng" / ${cellDeg}) * ${cellDeg} + ${cellDeg / 2} AS lng, COUNT(*) AS users
      FROM "UserRegion" GROUP BY 1, 2 HAVING COUNT(*) >= ${minUsers} ORDER BY users DESC LIMIT 500`;
    return rows.map((r) => ({ lat: Math.round(Number(r.lat) * 1000) / 1000, lng: Math.round(Number(r.lng) * 1000) / 1000, users: Number(r.users) }));
  }

  async audit(adminId: string, action: string, targetId: string, note: string | null, at: Date): Promise<void> {
    await this.prisma.adminAudit.create({ data: { adminId, action, targetType: action.includes('EVENT') ? 'PLACE_EVENT' : 'SETTING', targetId, note, createdAt: at } });
  }
}
