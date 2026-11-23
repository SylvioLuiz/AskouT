import { DomainError } from './errors.ts';
import type { HunterBridge } from './hunter-bridge.ts';

/**
 * A GESTÃO consulta o Hunter e publica. O Hunter só descobre e separa candidatos; aqui se acha o local, aplica a regra de
 * propriedade, barra duplicados e grava (tudo pela ponte). O que não puder publicar volta ao Hunter como "revisar" ou "rejeitado".
 */
export interface FeedItem { key: string; candidate: Record<string, unknown> }
export type AckResult = 'PUBLISHED' | 'REVIEW' | 'REJECTED';

export interface HunterFeed {
  fetchApproved(): Promise<FeedItem[]>;
  ack(key: string, result: AckResult, ref?: string): Promise<void>;
}

export interface SyncReport { at: string; seen: number; published: number; review: number; rejected: number; stoppedDisabled: boolean }

const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Mesmo local se um nome contém o outro (ex.: "Buxixo" e "Buxixo Rock Bar"). */
export function sameVenueName(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x));
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

export async function syncFromHunter(bridge: HunterBridge, feed: HunterFeed, now: Date = new Date()): Promise<SyncReport> {
  const report: SyncReport = { at: now.toISOString(), seen: 0, published: 0, review: 0, rejected: 0, stoppedDisabled: false };
  if (!(await bridge.isEnabled())) { report.stoppedDisabled = true; return report; }
  const items = await feed.fetchApproved();
  for (const { key, candidate: c } of items) {
    if (!/^[a-f0-9]{32}$/.test(key)) continue;
    report.seen += 1;
    const ref = `hunter:${key}`;
    const done = async (result: AckResult, askoutRef?: string): Promise<void> => {
      if (result === 'PUBLISHED') report.published += 1; else if (result === 'REJECTED') report.rejected += 1; else report.review += 1;
      await feed.ack(key, result, askoutRef);
    };
    try {
      const name = str(c['venueName']);
      const area = c['area'] as { lat?: unknown; lng?: unknown } | undefined;
      const startsAt = str(c['startsAt']);
      if (!name || !startsAt) { await done('REVIEW'); continue; }
      const found = await bridge.lookupVenues({ q: name, lat: area?.lat, lng: area?.lng });
      const venue = found.venues.find((v) => sameVenueName(v.name, name));
      if (!venue || !venue.canPublish) { await done('REVIEW'); continue; }
      const endsAt = str(c['endsAt']) ?? new Date(Date.parse(startsAt) + 4 * 3_600_000).toISOString();
      const r = await bridge.create({
        ref, venueId: venue.id, title: c['title'], description: c['description'], startsAt, endsAt,
        kind: c['kind'], isFree: c['free'] === true, imageUrl: c['imageUrl'], ticketUrl: c['ticketUrl'], tags: c['tags'],
      });
      if (r.ok) await done('PUBLISHED', ref);
      else if (r.refusal === 'DISABLED') { report.stoppedDisabled = true; break; }
      else if (r.refusal === 'DUPLICATE') await done('REJECTED');
      else await done('REVIEW');
    } catch (e) {
      // Dado recusado pela validação (evento já terminou, endereço inválido...): volta para revisão humana. Falha de rede: tenta de novo na próxima.
      if (e instanceof DomainError) await done('REVIEW').catch(() => undefined);
    }
  }
  return report;
}
