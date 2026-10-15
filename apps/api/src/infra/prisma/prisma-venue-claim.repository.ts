import type { PrismaClient } from '@prisma/client';
import { isUuid } from './helpers.ts';
import type { VenueClaimRepository } from '../../core/ports.ts';
import type { ClaimDocumentMime, ClaimStatus, VenueClaimRecord } from '../../core/types.ts';

interface ClaimRow {
  id: string;
  venueId: string;
  userId: string;
  status: ClaimStatus;
  note: string | null;
  documentMime: string;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

/** Nunca lê a coluna do documento, exceto em `findDocument`. */
const LIGHT = { id: true, venueId: true, userId: true, status: true, note: true, documentMime: true, reviewNote: true, reviewedBy: true, reviewedAt: true, createdAt: true } as const;

function toClaim(r: ClaimRow): VenueClaimRecord {
  return { id: r.id, venueId: r.venueId, userId: r.userId, status: r.status, note: r.note, documentMime: r.documentMime as ClaimDocumentMime, reviewNote: r.reviewNote, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, createdAt: r.createdAt };
}

export class PrismaVenueClaimRepository implements VenueClaimRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async create(c: VenueClaimRecord, document: Uint8Array): Promise<void> {
    await this.prisma.venueClaim.create({
      data: { id: c.id, venueId: c.venueId, userId: c.userId, status: c.status, note: c.note, documentMime: c.documentMime, document: Buffer.from(document), createdAt: c.createdAt },
    });
  }

  async findById(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.venueClaim.findUnique({ where: { id }, select: LIGHT });
    return r ? toClaim(r) : undefined;
  }

  async listByUser(userId: string) {
    const rows = await this.prisma.venueClaim.findMany({ where: { userId }, select: LIGHT, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 200 });
    return rows.map(toClaim);
  }

  async listByStatus(status: ClaimStatus, limit: number) {
    const rows = await this.prisma.venueClaim.findMany({ where: { status }, select: LIGHT, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit });
    return rows.map(toClaim);
  }

  async hasPending(venueId: string, userId: string) {
    return (await this.prisma.venueClaim.count({ where: { venueId, userId, status: 'PENDING' } })) > 0;
  }

  async review(id: string, status: 'APPROVED' | 'REJECTED', reviewerId: string, reviewNote: string | null, at: Date) {
    if (!isUuid(id)) return false;
    const res = await this.prisma.venueClaim.updateMany({ where: { id, status: 'PENDING' }, data: { status, reviewedBy: reviewerId, reviewNote, reviewedAt: at } });
    return res.count > 0;
  }

  async findDocument(id: string) {
    if (!isUuid(id)) return undefined;
    const r = await this.prisma.venueClaim.findUnique({ where: { id }, select: { documentMime: true, document: true } });
    return r ? { mime: r.documentMime, data: new Uint8Array(r.document) } : undefined;
  }
}
