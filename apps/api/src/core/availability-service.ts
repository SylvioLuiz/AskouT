import {
  evaluateInterval,
  findBestDates,
} from '@askout/availability-engine';
import type {
  AvailabilitySlot,
  CompatibilityResult,
  ParticipantAvailability,
  ParticipantStatus,
} from '@askout/availability-engine';
import { conflict, forbidden, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { AvailabilitySlotRecord, PublicProfile, SlotState } from './types.ts';
import { toPublicProfile } from './types.ts';

/** Limites escolhidos para proteger o banco e o motor; ajustáveis. */
export const MAX_SLOT_HOURS = 24;
export const MAX_ACTIVE_SLOTS = 300;
export const MAX_RANGE_DAYS = 62;
export const MAX_HORIZON_DAYS = 400;
export const MAX_FRIENDS_PER_QUERY = 9;
export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const STATES: readonly SlotState[] = ['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'];

export interface SlotInput {
  start?: unknown;
  end?: unknown;
  state?: unknown;
}

export interface SlotView {
  id: string;
  start: string;
  end: string;
  state: SlotState;
}

export interface FriendAvailability {
  profile: PublicProfile;
  slots: SlotView[];
}

export interface ParticipantView {
  profile: PublicProfile;
  status: ParticipantStatus;
  isMe: boolean;
}

export interface CompatibilityView {
  start: string;
  end: string;
  level: CompatibilityResult['level'];
  counts: CompatibilityResult['counts'];
  participants: ParticipantView[];
}

export interface BestDatesInput {
  friendIds?: unknown;
  fromDate?: unknown;
  toDate?: unknown;
  durationMinutes?: unknown;
  earliestStart?: unknown;
  latestStart?: unknown;
  timeZone?: unknown;
  limit?: unknown;
}

function toView(slot: AvailabilitySlotRecord): SlotView {
  return { id: slot.id, start: slot.startsAt.toISOString(), end: slot.endsAt.toISOString(), state: slot.state };
}

/** Só aceita instantes ISO 8601 completos (com fuso), para nunca interpretar data "solta" no fuso do servidor. */
function parseInstant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw validationError('Data e hora inválidas', { [field]: 'Use data e hora completas, com fuso (ex.: 2026-10-20T19:00:00-03:00)' });
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw validationError('Data e hora inválidas', { [field]: 'Data e hora inválidas' });
  return new Date(ms);
}

function parseLocalDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw validationError('Data inválida', { [field]: 'Use o formato AAAA-MM-DD' });
  }
  const check = new Date(`${value}T00:00:00Z`);
  if (check.toISOString().slice(0, 10) !== value) throw validationError('Data inválida', { [field]: 'Essa data não existe' });
  return value;
}

function parseHm(value: unknown, field: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw validationError('Horário inválido', { [field]: 'Use o formato HH:MM' });
  }
  return value;
}

function parseTimeZone(value: unknown): string {
  if (value === undefined) return DEFAULT_TIME_ZONE;
  if (typeof value !== 'string' || value.length > 64) throw validationError('Fuso horário inválido', { timeZone: 'Fuso horário inválido' });
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
  } catch {
    throw validationError('Fuso horário inválido', { timeZone: 'Fuso horário inválido' });
  }
  return value;
}

function parseRange(from: unknown, to: unknown): { from: Date; to: Date } {
  const start = parseInstant(from, 'from');
  const end = parseInstant(to, 'to');
  if (end <= start) throw validationError('O fim do período precisa ser depois do início', { to: 'Precisa ser depois do início' });
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw validationError(`Escolha um período de até ${MAX_RANGE_DAYS} dias`, { to: `Período máximo de ${MAX_RANGE_DAYS} dias` });
  }
  return { from: start, to: end };
}

function parseFriendIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw validationError('Escolha ao menos uma pessoa', { friendIds: 'Escolha ao menos uma pessoa' });
  }
  const unique = [...new Set(value)];
  if (unique.length > MAX_FRIENDS_PER_QUERY) {
    throw validationError(`Escolha até ${MAX_FRIENDS_PER_QUERY} pessoas`, { friendIds: `No máximo ${MAX_FRIENDS_PER_QUERY} pessoas` });
  }
  if (!unique.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 64)) {
    throw validationError('Pessoas inválidas', { friendIds: 'Pessoas inválidas' });
  }
  return unique as string[];
}

export class AvailabilityService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Marca um período como disponível, parcial ou indisponível. Não pode se sobrepor a outro horário seu. */
  async addSlot(actorId: string, input: SlotInput): Promise<SlotView> {
    const { availability, clock, ids } = this.deps;
    const problems: Record<string, string> = {};
    if (typeof input.state !== 'string' || !(STATES as readonly string[]).includes(input.state)) {
      problems.state = 'Escolha disponível, parcial ou indisponível';
    }
    let startsAt: Date | undefined;
    let endsAt: Date | undefined;
    try {
      startsAt = parseInstant(input.start, 'start');
    } catch {
      problems.start = 'Use data e hora completas, com fuso';
    }
    try {
      endsAt = parseInstant(input.end, 'end');
    } catch {
      problems.end = 'Use data e hora completas, com fuso';
    }
    if (startsAt && endsAt) {
      const length = endsAt.getTime() - startsAt.getTime();
      const now = clock.now().getTime();
      if (length <= 0) problems.end = 'O fim precisa ser depois do início';
      else if (length > MAX_SLOT_HOURS * HOUR_MS) problems.end = `Cada horário pode ter no máximo ${MAX_SLOT_HOURS} horas`;
      else if (endsAt.getTime() <= now) problems.start = 'Este horário já passou';
      else if (startsAt.getTime() > now + MAX_HORIZON_DAYS * DAY_MS) problems.start = 'Muito distante no futuro';
    }
    if (Object.keys(problems).length > 0) throw validationError('Confira os dados do horário', problems);

    if ((await availability.countActive(actorId, clock.now())) >= MAX_ACTIVE_SLOTS) {
      throw conflict(`Você chegou ao limite de ${MAX_ACTIVE_SLOTS} horários ativos. Remova algum para criar outro.`);
    }

    const record: AvailabilitySlotRecord = {
      id: ids.next(),
      userId: actorId,
      startsAt: startsAt!,
      endsAt: endsAt!,
      state: input.state as SlotState,
      createdAt: clock.now(),
    };
    await availability.add(record);
    return toView(record);
  }

  /** Remove um horário seu. Idempotente: apagar algo que não existe (ou que é de outra pessoa) não revela nada. */
  async removeSlot(actorId: string, slotId: string): Promise<{ removed: boolean }> {
    return { removed: await this.deps.availability.delete(actorId, slotId) };
  }

  async listMine(actorId: string, from: unknown, to: unknown): Promise<SlotView[]> {
    const range = parseRange(from, to);
    const rows = await this.deps.availability.listForUsers([actorId], range.from, range.to);
    return rows.map(toView);
  }

  /** A agenda de uma pessoa só é visível para os amigos dela (seguimento mútuo, sem bloqueio). */
  async listFriend(actorId: string, friendId: string, from: unknown, to: unknown): Promise<FriendAvailability> {
    const range = parseRange(from, to);
    await this.requireFriends(actorId, [friendId]);
    const [profile] = await this.deps.users.findProfilesByIds([friendId]);
    if (!profile) throw forbidden('Só amigos veem a agenda');
    const rows = await this.deps.availability.listForUsers([friendId], range.from, range.to);
    return { profile: toPublicProfile(profile), slots: rows.map(toView) };
  }

  /** Compatibilidade de um horário entre você e os amigos escolhidos. */
  async compatibility(actorId: string, input: { friendIds?: unknown; start?: unknown; end?: unknown }): Promise<CompatibilityView> {
    const friendIds = parseFriendIds(input.friendIds);
    const start = parseInstant(input.start, 'start');
    const end = parseInstant(input.end, 'end');
    if (end <= start) throw validationError('O fim precisa ser depois do início', { end: 'O fim precisa ser depois do início' });
    if (end.getTime() - start.getTime() > MAX_SLOT_HOURS * HOUR_MS) {
      throw validationError(`O encontro pode ter no máximo ${MAX_SLOT_HOURS} horas`, { end: 'Duração longa demais' });
    }
    await this.requireFriends(actorId, friendIds);

    const { people, profiles } = await this.loadParticipants(actorId, friendIds, start, end);
    const result = evaluateInterval(people, { start: start.getTime(), end: end.getTime() });
    return this.present(result, profiles, actorId);
  }

  /** "Encontrar melhor data": o melhor horário de cada dia, do mais ao menos compatível, para você e os amigos escolhidos. */
  async bestDates(actorId: string, input: BestDatesInput): Promise<CompatibilityView[]> {
    const friendIds = parseFriendIds(input.friendIds);
    const fromDate = parseLocalDate(input.fromDate, 'fromDate');
    const toDate = parseLocalDate(input.toDate, 'toDate');
    const days = (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / DAY_MS;
    if (days < 0) throw validationError('O período é inválido', { toDate: 'Precisa ser depois do início' });
    if (days + 1 > MAX_RANGE_DAYS) throw validationError(`Escolha um período de até ${MAX_RANGE_DAYS} dias`, { toDate: `Período máximo de ${MAX_RANGE_DAYS} dias` });

    const duration = input.durationMinutes === undefined ? 120 : input.durationMinutes;
    if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 15 || duration > MAX_SLOT_HOURS * 60) {
      throw validationError('Duração inválida', { durationMinutes: 'Entre 15 minutos e 24 horas' });
    }
    const limit = input.limit === undefined ? 5 : input.limit;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw validationError('Limite inválido', { limit: 'Entre 1 e 20' });
    }
    const earliestStart = parseHm(input.earliestStart, 'earliestStart', '17:00');
    const latestStart = parseHm(input.latestStart, 'latestStart', '22:00');
    if (latestStart < earliestStart) throw validationError('Horários inválidos', { latestStart: 'O último horário precisa ser depois do primeiro' });
    const timeZone = parseTimeZone(input.timeZone);

    await this.requireFriends(actorId, friendIds);

    // Janela larga o bastante para qualquer candidato (fusos, noite que passa da meia-noite).
    const windowStart = new Date(Date.parse(`${fromDate}T00:00:00Z`) - DAY_MS);
    const windowEnd = new Date(Date.parse(`${toDate}T00:00:00Z`) + 3 * DAY_MS);
    const { people, profiles } = await this.loadParticipants(actorId, friendIds, windowStart, windowEnd);

    // Pede todos os candidatos já ordenados e fica com o melhor de cada dia: horários quase iguais
    // (18:00, 18:30, 19:00...) na mesma noite não são alternativas de verdade para quem escolhe a data.
    const ranked = findBestDates({
      participants: people,
      rangeStartDate: fromDate,
      rangeEndDate: toDate,
      timeZone,
      durationMinutes: duration,
      earliestStart,
      latestStart,
      limit: Number.MAX_SAFE_INTEGER,
      now: this.deps.clock.now().getTime(),
    });
    const dayOf = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const seen = new Set<string>();
    const results: CompatibilityResult[] = [];
    for (const candidate of ranked) {
      const day = dayOf.format(new Date(candidate.interval.start));
      if (seen.has(day)) continue;
      seen.add(day);
      results.push(candidate);
      if (results.length >= limit) break;
    }
    return results.map((r) => this.present(r, profiles, actorId));
  }

  private async requireFriends(actorId: string, otherIds: string[]): Promise<void> {
    const friends = new Set(await this.deps.follows.listFriendIds(actorId));
    if (!otherIds.every((id) => friends.has(id))) throw forbidden('Só amigos veem a agenda e comparam horários');
  }

  private async loadParticipants(actorId: string, friendIds: string[], from: Date, to: Date) {
    const everyone = [actorId, ...friendIds];
    const [rows, profileList] = await Promise.all([
      this.deps.availability.listForUsers(everyone, from, to),
      this.deps.users.findProfilesByIds(everyone),
    ]);
    const profiles = new Map(profileList.map((p) => [p.userId, p] as const));
    if (!everyone.every((id) => profiles.has(id))) throw forbidden('Só amigos veem a agenda e comparam horários');

    const people: ParticipantAvailability[] = everyone.map((userId) => ({
      userId,
      slots: rows
        .filter((r) => r.userId === userId)
        .map((r): AvailabilitySlot => ({
          start: r.startsAt.getTime(),
          end: r.endsAt.getTime(),
          state: r.state === 'AVAILABLE' ? 'available' : r.state === 'PARTIAL' ? 'partial' : 'unavailable',
        })),
      busy: [],
    }));
    return { people, profiles };
  }

  private present(
    result: CompatibilityResult,
    profiles: Map<string, { userId: string; username: string; displayName: string; avatarUrl: string | null; isPrivate: boolean; bio: string | null }>,
    actorId: string,
  ): CompatibilityView {
    return {
      start: new Date(result.interval.start).toISOString(),
      end: new Date(result.interval.end).toISOString(),
      level: result.level,
      counts: result.counts,
      // Só o estado de cada pessoa; o motivo (ex.: calendário externo) não sai do servidor.
      participants: result.participants.map((p) => ({
        profile: toPublicProfile(profiles.get(p.userId)!),
        status: p.status,
        isMe: p.userId === actorId,
      })),
    };
  }
}
