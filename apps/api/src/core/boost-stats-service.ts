import { createHash } from 'node:crypto';
import { boostPhase } from './boost-service.ts';
import type { BoostPhase } from './boost-service.ts';
import { notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { BoostAudience, BoostPlacement, BoostRecord, BoostStatKind } from './types.ts';

/** Quantos registros chegam por envio. */
export const BOOST_TRACK_BATCH_MAX = 20;
/** No Match, abaixo disso o relatório mostra "menos de 10" (o público é pequeno e escolhido pelo dono). */
export const BOOST_STATS_MATCH_FLOOR = 10;
/** Fuso dos dias do relatório. */
export const BOOST_STATS_TIME_ZONE = 'America/Sao_Paulo';

const DAY_MS = 86_400_000;
const KINDS: readonly BoostStatKind[] = ['IMPRESSION', 'OPEN', 'TICKET'];
const PLACEMENTS: readonly BoostPlacement[] = ['EXPLORE', 'HOME', 'MATCH', 'EVENT_PAGE'];
/** De quanto em quanto tempo as marcações velhas são apagadas (não precisa ser a cada envio). */
const PURGE_EVERY_MS = 3_600_000;

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: BOOST_STATS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Data (AAAA-MM-DD) no fuso de Brasília. */
export function statDay(at: Date): string {
  return dayFormat.format(at);
}

export interface BoostTrackInput {
  kind?: unknown;
  placement?: unknown;
  eventId?: unknown;
  venueId?: unknown;
}

/** Número do relatório. `null` = "menos de 10" (só no Match). */
export type BoostStatValue = number | null;

export interface BoostStatsDay {
  day: string;
  impressions: BoostStatValue;
  opens: BoostStatValue;
  ticketClicks: BoostStatValue;
}

export interface BoostReport {
  boostId: string;
  phase: BoostPhase;
  audience: BoostAudience;
  startsAt: string | null;
  endsAt: string | null;
  /** No Match os números são arredondados para baixo de 10 em 10 e abaixo de 10 viram `null`. */
  rounded: boolean;
  totals: { impressions: BoostStatValue; opens: BoostStatValue; ticketClicks: BoostStatValue };
  /** Aberturas ÷ exibições, em % inteiro. `null` sem exibições suficientes. */
  openRatePct: number | null;
  /** Um item por dia da campanha até hoje (dias sem nada aparecem com zero). */
  days: BoostStatsDay[];
  /** Exibições por lugar do app. */
  placements: { placement: BoostPlacement; impressions: BoostStatValue }[];
}

/**
 * Relatório do anúncio para quem paga: quantas pessoas viram, abriram e foram ao site de ingresso.
 *
 * Por que não usa as medições de tempo de tela (`ContentDwell`): elas só existem para quem deixou as
 * recomendações ligadas, somem quando a pessoa apaga o histórico e foram coletadas para recomendar, não
 * para relatório de anúncio. Aqui só se guardam contadores por dia; a marcação de "já contei hoje"
 * (para cada pessoa contar uma vez por dia) guarda uma chave embaralhada e é apagada em 2 dias.
 *
 * Quem decide a qual anúncio o número pertence é o servidor: o app só diz o que mostrou e onde.
 */
export class BoostStatsService {
  private readonly deps: CoreDeps;
  private lastPurge = 0;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** O app avisa o que mostrou como "Patrocinado". Registros que não batem com um anúncio ativo são ignorados (não é erro). */
  async track(viewerId: string, items: unknown): Promise<{ counted: number }> {
    if (!Array.isArray(items) || items.length === 0 || items.length > BOOST_TRACK_BATCH_MAX) {
      throw validationError('Envio inválido', { items: `Mande de 1 a ${BOOST_TRACK_BATCH_MAX} registros` });
    }
    const parsed = (items as unknown[]).map(parseItem);
    const now = this.deps.clock.now();
    const today = statDay(now);
    const yesterday = statDay(new Date(now.getTime() - DAY_MS));
    const active = await this.deps.boosts.listActive(now);
    let counted = 0;
    if (active.length > 0) {
      const venueOfEvent = new Map<string, string | null>();
      for (const item of parsed) {
        let venueId = item.venueId;
        if (item.eventId) {
          // O local vem do evento guardado, nunca do app (senão daria para contar no anúncio de outro local).
          if (!venueOfEvent.has(item.eventId)) venueOfEvent.set(item.eventId, (await this.deps.places.findEvent(item.eventId))?.venue.id ?? null);
          venueId = venueOfEvent.get(item.eventId) ?? undefined;
          if (!venueId) continue;
        }
        const boost = pickBoost(active, item, venueId, viewerId);
        if (!boost) continue;
        const viewerKey = keyFor(boost.id, viewerId);
        if (item.kind === 'TICKET') {
          // O clique no ingresso só conta para quem viu ou abriu o anúncio hoje ou ontem.
          let saw = false;
          for (const day of [today, yesterday]) {
            for (const kind of ['IMPRESSION', 'OPEN'] as const) {
              if (!saw && (await this.deps.boostStats.wasCounted({ boostId: boost.id, day, kind, viewerKey }))) saw = true;
            }
          }
          if (!saw) continue;
        }
        if (await this.deps.boostStats.countOnce({ boostId: boost.id, day: today, kind: item.kind, placement: item.placement, viewerKey })) counted += 1;
      }
    }
    if (now.getTime() - this.lastPurge >= PURGE_EVERY_MS) {
      this.lastPurge = now.getTime();
      await this.deps.boostStats.purgeSeenBefore(yesterday);
    }
    return { counted };
  }

  /** Só quem pagou o anúncio vê o relatório (para os outros, "não encontrado"). */
  async report(ownerId: string, boostId: unknown): Promise<BoostReport> {
    if (typeof boostId !== 'string' || boostId === '' || boostId.length > 64) throw notFound('Impulsionamento não encontrado');
    const boost = await this.deps.boosts.find(boostId);
    if (!boost || boost.ownerId !== ownerId) throw notFound('Impulsionamento não encontrado');
    const now = this.deps.clock.now();
    const rows = await this.deps.boostStats.listByBoost(boost.id);
    const rounded = boost.audience === 'MATCH';
    const show = (n: number): BoostStatValue => (!rounded ? n : n < BOOST_STATS_MATCH_FLOOR ? null : Math.floor(n / 10) * 10);

    const sum = { IMPRESSION: 0, OPEN: 0, TICKET: 0 } as Record<BoostStatKind, number>;
    const byDay = new Map<string, Record<BoostStatKind, number>>();
    const byPlacement = new Map<BoostPlacement, number>();
    for (const r of rows) {
      sum[r.kind] += r.count;
      const d = byDay.get(r.day) ?? { IMPRESSION: 0, OPEN: 0, TICKET: 0 };
      d[r.kind] += r.count;
      byDay.set(r.day, d);
      if (r.kind === 'IMPRESSION') byPlacement.set(r.placement, (byPlacement.get(r.placement) ?? 0) + r.count);
    }

    const dayKeys = campaignDays(boost, now);
    for (const k of byDay.keys()) if (!dayKeys.includes(k)) dayKeys.push(k);
    dayKeys.sort();

    const enough = rounded ? sum.IMPRESSION >= BOOST_STATS_MATCH_FLOOR : sum.IMPRESSION > 0;
    return {
      boostId: boost.id,
      phase: boostPhase(boost, now),
      audience: boost.audience,
      startsAt: boost.startsAt?.toISOString() ?? null,
      endsAt: boost.endsAt?.toISOString() ?? null,
      rounded,
      totals: { impressions: show(sum.IMPRESSION), opens: show(sum.OPEN), ticketClicks: show(sum.TICKET) },
      openRatePct: enough ? Math.round((sum.OPEN / sum.IMPRESSION) * 100) : null,
      days: dayKeys.map((day) => {
        const d = byDay.get(day) ?? { IMPRESSION: 0, OPEN: 0, TICKET: 0 };
        return { day, impressions: show(d.IMPRESSION), opens: show(d.OPEN), ticketClicks: show(d.TICKET) };
      }),
      placements: PLACEMENTS.filter((p) => byPlacement.has(p)).map((placement) => ({ placement, impressions: show(byPlacement.get(placement)!) })),
    };
  }
}

interface TrackItem {
  kind: BoostStatKind;
  placement: BoostPlacement;
  eventId?: string;
  venueId?: string;
}

function parseItem(raw: unknown): TrackItem {
  if (typeof raw !== 'object' || raw === null) throw validationError('Registro inválido', { items: 'Registro inválido' });
  const { kind, placement, eventId, venueId } = raw as BoostTrackInput;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) throw validationError('Registro inválido', { kind: 'Use IMPRESSION, OPEN ou TICKET' });
  if (typeof placement !== 'string' || !(PLACEMENTS as readonly string[]).includes(placement)) throw validationError('Registro inválido', { placement: 'Lugar inválido' });
  const id = (v: unknown, field: string): string | undefined => {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string' || v === '' || v.length > 64) throw validationError('Registro inválido', { [field]: 'Identificador inválido' });
    return v;
  };
  const item: TrackItem = { kind: kind as BoostStatKind, placement: placement as BoostPlacement };
  const e = id(eventId, 'eventId');
  const v = id(venueId, 'venueId');
  if (e) item.eventId = e;
  if (v) item.venueId = v;
  if (!item.eventId && !item.venueId) throw validationError('Registro inválido', { eventId: 'Informe o evento ou o local' });
  // O ingresso é sempre de um evento, na página dele. A exibição e a abertura são nos cartões.
  if (item.kind === 'TICKET' && (item.placement !== 'EVENT_PAGE' || !item.eventId)) throw validationError('Registro inválido', { placement: 'O ingresso é registrado na página do evento' });
  if (item.kind !== 'TICKET' && item.placement === 'EVENT_PAGE') throw validationError('Registro inválido', { placement: 'Lugar inválido' });
  return item;
}

/**
 * Qual anúncio ativo responde por este cartão: o do evento, se houver; senão o do local.
 * Match só aparece no "Para você"; o destaque para todos, no Explorar e na Home. O dono não conta.
 */
function pickBoost(active: BoostRecord[], item: TrackItem, venueId: string | undefined, viewerId: string): BoostRecord | undefined {
  const fits = (b: BoostRecord) => {
    if (b.ownerId === viewerId) return false;
    if (item.placement === 'MATCH') return b.audience === 'MATCH';
    if (item.placement === 'EXPLORE' || item.placement === 'HOME') return b.audience === 'ALL';
    return true;
  };
  const byEvent = item.eventId ? active.find((b) => fits(b) && b.target === 'EVENT' && b.eventId === item.eventId) : undefined;
  if (byEvent) return byEvent;
  return venueId ? active.find((b) => fits(b) && b.target === 'VENUE' && b.venueId === venueId) : undefined;
}

/** Chave da pessoa para aquele anúncio: não se repete entre anúncios e não guarda o id. */
function keyFor(boostId: string, viewerId: string): string {
  return createHash('sha256').update(`askout-boost-stat:${boostId}:${viewerId}`).digest('base64url').slice(0, 32);
}

/** Dias da campanha, do início até o fim ou até hoje (o que vier antes). Até 31 dias. */
function campaignDays(boost: BoostRecord, now: Date): string[] {
  if (!boost.startsAt) return [];
  const start = boost.startsAt.getTime();
  const last = Math.min(now.getTime(), (boost.endsAt?.getTime() ?? now.getTime()) - 1);
  const out: string[] = [];
  for (let t = start; t <= last && out.length < 31; t += DAY_MS) {
    const d = statDay(new Date(t));
    if (!out.includes(d)) out.push(d);
  }
  const lastDay = last >= start ? statDay(new Date(last)) : undefined;
  if (lastDay && !out.includes(lastDay) && out.length < 31) out.push(lastDay);
  return out;
}
