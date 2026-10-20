import { evaluateInterval } from '@askout/availability-engine';
import type { CompatibilityLevel, ParticipantAvailability } from '@askout/availability-engine';
import { forbidden, validationError } from './errors.ts';
import { fold } from './explore-match.ts';
import type { CoreDeps } from './ports.ts';
import type { EventKind, PlaceEventRecord, VenueRecord } from './types.ts';

/** Quantas pessoas além de você (mesmo limite da comparação de agendas). */
export const GROUP_MAX_FRIENDS = 9;
export const GROUP_DEFAULT_DAYS = 14;
export const GROUP_MAX_DAYS = 30;
export const GROUP_DEFAULT_LIMIT = 5;
export const GROUP_MAX_LIMIT = 10;
/** Quantos eventos de cada pessoa (presenças) entram no perfil de gosto. */
export const GROUP_HISTORY_EVENTS = 50;
/** Peso do gosto e da data na nota final. */
export const GROUP_INTEREST_WEIGHT = 0.6;
export const GROUP_DATE_WEIGHT = 0.4;

const KIND_LABEL: Record<EventKind, string> = {
  DIGITAL: 'eventos online',
  SHOW: 'shows',
  CINEMA: 'cinema',
  THEATER: 'teatro',
  EXHIBITION: 'exposições',
  GASTRONOMY: 'gastronomia',
  NIGHT: 'baladas',
  OUTDOOR: 'ao ar livre',
  SPORT: 'esportes',
  OTHER: 'rolês',
};

/** O que uma pessoa demonstrou gostar: locais que segue e eventos em que confirmou presença. */
export interface TasteProfile {
  venueIds: Set<string>;
  categories: Set<string>;
  kinds: Map<EventKind, number>;
  tags: Set<string>;
}

export type GroupDateFit = 'ALL_FREE' | 'MOST_FREE' | 'UNKNOWN';

export interface GroupSuggestion {
  event: {
    id: string;
    title: string;
    kind: EventKind;
    isFree: boolean;
    imageUrl: string | null;
    venueId: string;
    venueName: string;
    startsAt: string;
    endsAt: string;
    sample: boolean;
  };
  /** 0 a 100: gosto do grupo (60%) e data compatível (40%). */
  score: number;
  /** Motivos em linguagem simples. Nunca dizem quem gosta do quê. */
  reasons: string[];
  dateFit: GroupDateFit;
}

export interface GroupSuggestionsView {
  /** Quantas pessoas entraram na conta, você incluída. */
  people: number;
  /** false quando ninguém tem histórico de gosto (nada seguido, nenhuma presença): a lista fica vazia. */
  hasTaste: boolean;
  items: GroupSuggestion[];
}

function emptyTaste(): TasteProfile {
  return { venueIds: new Set(), categories: new Set(), kinds: new Map(), tags: new Set() };
}

export function addToTaste(taste: TasteProfile, venue: VenueRecord, event?: PlaceEventRecord): void {
  taste.venueIds.add(venue.id);
  if (venue.category) taste.categories.add(fold(venue.category));
  if (event) {
    taste.kinds.set(event.kind, (taste.kinds.get(event.kind) ?? 0) + 1);
    for (const t of event.tags) taste.tags.add(t);
  }
}

export interface Affinity {
  value: number;
  venue: boolean;
  kind: boolean;
  category: boolean;
  tags: string[];
}

/** 0 a 1: o quanto este evento combina com o gosto de uma pessoa. Sem nenhum ponto em comum, 0. */
export function affinity(taste: TasteProfile, event: PlaceEventRecord, venue: VenueRecord): Affinity {
  const venueMatch = taste.venueIds.has(venue.id);
  const kindMatch = event.kind !== 'OTHER' && taste.kinds.has(event.kind);
  const categoryMatch = venue.category !== null && taste.categories.has(fold(venue.category));
  const tags = event.tags.filter((t) => taste.tags.has(t));
  const value = Math.min(1, (venueMatch ? 0.5 : 0) + (kindMatch ? 0.25 : 0) + (categoryMatch ? 0.2 : 0) + Math.min(0.3, tags.length * 0.15));
  return { value, venue: venueMatch, kind: kindMatch, category: categoryMatch, tags };
}

/** Agrada o grupo: média e pior caso pesam igual, então um evento que só uma pessoa adora perde para um que todos acham bom. */
export function groupInterest(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return 0.5 * mean + 0.5 * Math.min(...values);
}

const DATE_SCORE: Record<CompatibilityLevel, number> = { green: 1, orange: 0.6, awaiting: 0.4, red: 0 };

/** Quem marcou "não posso" tira o evento da lista, mesmo que outras pessoas ainda não tenham informado a agenda. */
export function dateFitOf(level: CompatibilityLevel, unavailable = 0): GroupDateFit | undefined {
  if (unavailable > 0) return undefined;
  if (level === 'green') return 'ALL_FREE';
  if (level === 'orange') return 'MOST_FREE';
  if (level === 'awaiting') return 'UNKNOWN';
  return undefined;
}

export function finalScore(interest: number, level: CompatibilityLevel): number {
  return Math.round(100 * (GROUP_INTEREST_WEIGHT * interest + GROUP_DATE_WEIGHT * DATE_SCORE[level]));
}

function parseDays(value: unknown): number {
  if (value === undefined) return GROUP_DEFAULT_DAYS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > GROUP_MAX_DAYS) {
    throw validationError('Período inválido', { days: `Entre 1 e ${GROUP_MAX_DAYS} dias` });
  }
  return value;
}

function parseLimit(value: unknown): number {
  if (value === undefined) return GROUP_DEFAULT_LIMIT;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > GROUP_MAX_LIMIT) {
    throw validationError('Limite inválido', { limit: `Entre 1 e ${GROUP_MAX_LIMIT}` });
  }
  return value;
}

function parseFriendIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) throw validationError('Escolha ao menos uma pessoa', { friendIds: 'Escolha ao menos uma pessoa' });
  const unique = [...new Set(value)];
  if (unique.length > GROUP_MAX_FRIENDS) throw validationError(`Escolha até ${GROUP_MAX_FRIENDS} pessoas`, { friendIds: `No máximo ${GROUP_MAX_FRIENDS} pessoas` });
  if (!unique.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)) throw validationError('Pessoas inválidas', { friendIds: 'Pessoas inválidas' });
  return unique as string[];
}

/**
 * Motor de inteligência social: junta o gosto de você e dos amigos escolhidos (locais que seguem, eventos a que
 * foram) e a agenda de cada um, e sugere eventos que o grupo provavelmente vai curtir em dia que dá para todos.
 * Só amigos (seguimento mútuo). A resposta mostra o resultado do grupo, nunca o gosto nem a agenda de uma pessoa.
 */
export class GroupMatchService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async suggest(actorId: string, input: { friendIds?: unknown; days?: unknown; limit?: unknown }): Promise<GroupSuggestionsView> {
    const friendIds = parseFriendIds(input.friendIds);
    const days = parseDays(input.days);
    const limit = parseLimit(input.limit);
    const friends = new Set(await this.deps.follows.listFriendIds(actorId));
    if (!friendIds.every((id) => friends.has(id))) throw forbidden('Só dá para sugerir rolês para amigos');

    const everyone = [actorId, ...friendIds];
    const now = this.deps.clock.now();
    const to = new Date(now.getTime() + days * 86_400_000);

    const tastes = await Promise.all(everyone.map((id) => this.tasteOf(id)));
    const hasTaste = tastes.some((t) => t.venueIds.size > 0);
    if (!hasTaste) return { people: everyone.length, hasTaste: false, items: [] };

    const candidates = await this.deps.places.searchEvents({ from: now, to, limit: 300 });
    const rows = await this.deps.availability.listForUsers(everyone, now, new Date(to.getTime() + 86_400_000));
    const people: ParticipantAvailability[] = everyone.map((userId) => ({
      userId,
      slots: rows.filter((r) => r.userId === userId).map((r) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime(), state: r.state === 'AVAILABLE' ? ('available' as const) : r.state === 'PARTIAL' ? ('partial' as const) : ('unavailable' as const) })),
      busy: [],
    }));

    const scored: (GroupSuggestion & { startMs: number })[] = [];
    for (const { event, venue } of candidates) {
      if (event.endsAt <= now) continue;
      const affs = tastes.map((t) => affinity(t, event, venue));
      const interest = groupInterest(affs.map((a) => a.value));
      if (affs.every((a) => a.value === 0)) continue;
      const result = evaluateInterval(people, { start: Math.max(event.startsAt.getTime(), now.getTime()), end: event.endsAt.getTime() });
      const fit = dateFitOf(result.level, result.counts.unavailable);
      if (!fit) continue; // pelo menos uma pessoa não pode: não adianta sugerir
      scored.push({
        event: { id: event.id, title: event.title, kind: event.kind, isFree: event.isFree, imageUrl: event.imageUrl, venueId: venue.id, venueName: venue.name, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString(), sample: event.isSample || venue.isSample },
        score: finalScore(interest, result.level),
        reasons: this.reasons(affs, event, venue, fit),
        dateFit: fit,
        startMs: event.startsAt.getTime(),
      });
    }
    scored.sort((a, b) => b.score - a.score || a.startMs - b.startMs || (a.event.id < b.event.id ? -1 : 1));
    return { people: everyone.length, hasTaste: true, items: scored.slice(0, limit).map(({ startMs: _startMs, ...rest }) => rest) };
  }

  private reasons(affs: Affinity[], event: PlaceEventRecord, venue: VenueRecord, fit: GroupDateFit): string[] {
    const half = Math.ceil(affs.length / 2);
    const out: string[] = [];
    if (affs.filter((a) => a.venue).length >= half) out.push('O grupo segue ou já foi a este local');
    if (affs.filter((a) => a.kind).length >= half) out.push(`Vocês curtem ${KIND_LABEL[event.kind]}`);
    else if (affs.filter((a) => a.category).length >= half && venue.category) out.push(`Vocês curtem ${fold(venue.category)}`);
    const tag = event.tags.find((t) => affs.filter((a) => a.tags.includes(t)).length >= half);
    if (tag) out.push(`Tem a ver com #${tag}`);
    if (out.length === 0) out.push('Combina com o gosto de parte do grupo');
    out.push(fit === 'ALL_FREE' ? 'Dia livre para todos' : fit === 'MOST_FREE' ? 'Dá para todos, alguns só em parte' : 'Ninguém marcou que está ocupado');
    return out;
  }

  private async tasteOf(userId: string): Promise<TasteProfile> {
    const taste = emptyTaste();
    const followed = await this.deps.places.listFollowedVenueIds(userId);
    for (const id of followed) {
      const venue = await this.deps.places.findVenue(id);
      if (venue) addToTaste(taste, venue);
    }
    const went = await this.deps.eventRoom.listGoingByUser(userId, GROUP_HISTORY_EVENTS);
    for (const { ref } of went) {
      if (ref.source !== 'PLACE') continue;
      const found = await this.deps.places.findEvent(ref.id);
      if (found) addToTaste(taste, found.venue, found.event);
    }
    return taste;
  }
}
