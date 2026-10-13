import type {
  CompatibilityLevel,
  CompatibilityResult,
  Counts,
  Interval,
  ParticipantAvailability,
  ParticipantResult,
} from './types.ts';
import { coveredDuration, isValidInterval, mergeIntervals, overlaps, zonedTimeToUtc } from './time.ts';

/**
 * Avalia UM participante para UM intervalo.
 *
 * Precedência (briefing, seção 10.4):
 *  1. Indisponibilidade manual explícita prevalece.
 *  2. Compromisso externo ocupado gera conflito.
 *  3. Disponibilidade manual define quando o usuário aceita propostas.
 *     - cobre o intervalo inteiro  -> available
 *     - cobre só parte, ou há slot "partial" -> partial
 *  4. Sem informação suficiente -> unknown (nunca vira "indisponível").
 *
 * Um horário livre no calendário externo NÃO significa disponível.
 */
export function evaluateParticipant(p: ParticipantAvailability, target: Interval): ParticipantResult {
  const base = { userId: p.userId };

  if (p.slots.some((s) => s.state === 'unavailable' && isValidInterval(s) && overlaps(s, target))) {
    return { ...base, status: 'unavailable', reason: 'manual_unavailable' };
  }

  if (p.busy.some((b) => isValidInterval(b) && overlaps(b, target))) {
    return { ...base, status: 'unavailable', reason: 'external_busy' };
  }

  const availableMerged = mergeIntervals(p.slots.filter((s) => s.state === 'available'));
  const covered = coveredDuration(availableMerged, target);
  if (covered >= target.end - target.start) {
    return { ...base, status: 'available', reason: 'fully_available' };
  }

  if (p.slots.some((s) => s.state === 'partial' && isValidInterval(s) && overlaps(s, target))) {
    return { ...base, status: 'partial', reason: 'partial_slot' };
  }

  if (covered > 0) {
    return { ...base, status: 'partial', reason: 'partial_coverage' };
  }

  return { ...base, status: 'unknown', reason: 'no_information' };
}

/**
 * Regras de classificação (confirmadas pelo produto):
 *  - qualquer participante sem informação  -> awaiting
 *  - todos disponíveis integralmente       -> green
 *  - (disponíveis + parciais) >= metade     -> orange
 *  - caso contrário                         -> red
 */
export function classify(c: Counts): CompatibilityLevel {
  if (c.unknown > 0) return 'awaiting';
  if (c.available === c.total) return 'green';
  if ((c.available + c.partial) * 2 >= c.total) return 'orange';
  return 'red';
}

export function evaluateInterval(participants: ParticipantAvailability[], target: Interval): CompatibilityResult {
  if (!isValidInterval(target)) throw new RangeError('Intervalo do encontro inválido');
  if (participants.length === 0) throw new RangeError('É necessário ao menos um participante');

  const results = participants.map((p) => evaluateParticipant(p, target));
  const counts: Counts = {
    total: results.length,
    available: results.filter((r) => r.status === 'available').length,
    partial: results.filter((r) => r.status === 'partial').length,
    unavailable: results.filter((r) => r.status === 'unavailable').length,
    unknown: results.filter((r) => r.status === 'unknown').length,
  };

  return { interval: target, level: classify(counts), counts, participants: results };
}

export interface FindBestDatesOptions {
  participants: ParticipantAvailability[];
  /** Datas locais 'YYYY-MM-DD', ambas inclusivas. */
  rangeStartDate: string;
  rangeEndDate: string;
  /** Fuso IANA usado para gerar os horários candidatos, ex.: 'America/Sao_Paulo'. */
  timeZone: string;
  durationMinutes: number;
  /** Primeiro e último horário de INÍCIO candidato ('HH:MM', local). */
  earliestStart?: string;
  latestStart?: string;
  stepMinutes?: number;
  limit?: number;
  /** Ignora candidatos que começam antes deste instante. */
  now?: number;
}

const LEVEL_RANK: Record<CompatibilityLevel, number> = { green: 0, orange: 1, awaiting: 2, red: 3 };

function parseHm(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`Horário inválido: ${value}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new RangeError(`Horário inválido: ${value}`);
  return h * 60 + min;
}

function parseDate(value: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`Data inválida: ${value}`);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/**
 * "Encontrar melhor data": gera candidatos (dia x horário) e ordena por compatibilidade.
 * Ordenação: nível (verde > laranja > aguardando > vermelho), mais disponíveis,
 * mais parciais, menos sem informação, e por fim o mais cedo.
 */
export function findBestDates(opts: FindBestDatesOptions): CompatibilityResult[] {
  const {
    participants,
    rangeStartDate,
    rangeEndDate,
    timeZone,
    durationMinutes,
    earliestStart = '17:00',
    latestStart = '22:00',
    stepMinutes = 30,
    limit = 10,
    now,
  } = opts;

  if (!(durationMinutes > 0)) throw new RangeError('Duração inválida');
  if (!(stepMinutes > 0)) throw new RangeError('Passo inválido');

  const from = parseDate(rangeStartDate);
  const to = parseDate(rangeEndDate);
  const firstMin = parseHm(earliestStart);
  const lastMin = parseHm(latestStart);
  const dayMs = 24 * 60 * 60 * 1000;
  const startDay = Date.UTC(from.y, from.m - 1, from.d);
  const endDay = Date.UTC(to.y, to.m - 1, to.d);
  if (endDay < startDay) throw new RangeError('Período inválido');

  const results: CompatibilityResult[] = [];
  for (let day = startDay; day <= endDay; day += dayMs) {
    const dt = new Date(day);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth() + 1;
    const d = dt.getUTCDate();
    for (let minute = firstMin; minute <= lastMin; minute += stepMinutes) {
      const start = zonedTimeToUtc(y, mo, d, Math.floor(minute / 60), minute % 60, timeZone);
      if (now !== undefined && start < now) continue;
      results.push(evaluateInterval(participants, { start, end: start + durationMinutes * 60_000 }));
    }
  }

  results.sort(
    (a, b) =>
      LEVEL_RANK[a.level] - LEVEL_RANK[b.level] ||
      b.counts.available - a.counts.available ||
      b.counts.partial - a.counts.partial ||
      a.counts.unknown - b.counts.unknown ||
      a.interval.start - b.interval.start,
  );

  return results.slice(0, limit);
}
