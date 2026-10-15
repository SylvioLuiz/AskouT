/**
 * Cálculo da votação de datas ("Encontrar a melhor data"). Tudo aqui é puro: recebe votos e devolve números,
 * sem banco nem relógio. Data é sempre um dia do calendário no formato AAAA-MM-DD (o fuso fica com quem chama).
 */

/** POSSO, TALVEZ e NÃO POSSO. Data sem voto é "sem resposta" e não conta como voto negativo. */
export type VoteStatus = 'YES' | 'MAYBE' | 'NO';
export const VOTE_STATUSES: readonly VoteStatus[] = ['YES', 'MAYBE', 'NO'];

/** Pesos iniciais da compatibilidade. */
export const VOTE_WEIGHT: Record<VoteStatus, number> = { YES: 1, MAYBE: 0.5, NO: 0 };

export type HeatLevel = 'GREEN' | 'ORANGE' | 'RED' | 'GRAY';

/** Limites do mapa de calor, em %. Configuráveis por votação. */
export interface Thresholds {
  /** Verde: compatibilidade igual ou acima disto. */
  green: number;
  /** Laranja: igual ou acima disto e abaixo do verde. Abaixo é vermelho. */
  orange: number;
  /** Cobertura mínima para a data valer como informação; abaixo disso fica cinza. */
  minCoverage: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { green: 80, orange: 50, minCoverage: 50 };

export interface VoteRow {
  userId: string;
  date: string;
  status: VoteStatus;
}

export interface DateStats {
  date: string;
  yes: number;
  maybe: number;
  no: number;
  /** Convidados elegíveis que não responderam nesta data. */
  unanswered: number;
  answered: number;
  total: number;
  /** Soma dos pesos / quem respondeu × 100 (uma casa). Nulo se ninguém respondeu. */
  compatibility: number | null;
  /** Quem respondeu / convidados elegíveis × 100 (inteiro). */
  coverage: number;
  /** Cobertura acima do mínimo: só então a cor vale como consenso. */
  sufficient: boolean;
  level: HeatLevel;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Confere formato e existência do dia (não aceita 2026-02-31). */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/** Todos os dias de `start` a `end`, inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

export function levelFor(compatibility: number | null, coverage: number, th: Thresholds): HeatLevel {
  if (compatibility === null || coverage < th.minCoverage) return 'GRAY';
  if (compatibility >= th.green) return 'GREEN';
  if (compatibility >= th.orange) return 'ORANGE';
  return 'RED';
}

/** Estatísticas de cada dia. Voto de quem não é convidado e de dia fora da lista é ignorado. */
export function computeDateStats(dates: readonly string[], votes: readonly VoteRow[], participantIds: readonly string[], th: Thresholds = DEFAULT_THRESHOLDS): DateStats[] {
  const eligible = new Set(participantIds);
  const total = eligible.size;
  const byDate = new Map<string, Map<string, VoteStatus>>();
  for (const v of votes) {
    if (!eligible.has(v.userId)) continue;
    let m = byDate.get(v.date);
    if (!m) byDate.set(v.date, (m = new Map()));
    m.set(v.userId, v.status);
  }
  return dates.map((date) => {
    const m = byDate.get(date) ?? new Map<string, VoteStatus>();
    let yes = 0, maybe = 0, no = 0, sum = 0;
    for (const s of m.values()) {
      if (s === 'YES') yes += 1;
      else if (s === 'MAYBE') maybe += 1;
      else no += 1;
      sum += VOTE_WEIGHT[s];
    }
    const answered = yes + maybe + no;
    const raw = answered === 0 ? null : (sum / answered) * 100;
    const coverageRaw = total === 0 ? 0 : (answered / total) * 100;
    return {
      date,
      yes,
      maybe,
      no,
      unanswered: total - answered,
      answered,
      total,
      compatibility: raw === null ? null : Math.round(raw * 10) / 10,
      coverage: Math.round(coverageRaw),
      sufficient: total > 0 && coverageRaw >= th.minCoverage,
      level: levelFor(raw, coverageRaw, th),
    };
  });
}

/**
 * Melhores datas. Só entram dias com ao menos uma pessoa disponível (POSSO ou TALVEZ). Ordem:
 * 1) mais gente disponível (POSSO), 2) menos indisponíveis, 3) maior cobertura, 4) menos TALVEZ,
 * 5) maior compatibilidade, 6) data mais cedo (desempate fixo).
 */
export function rankDates(stats: readonly DateStats[]): DateStats[] {
  return stats
    .filter((s) => s.yes + s.maybe > 0)
    .sort(
      (a, b) =>
        b.yes - a.yes ||
        a.no - b.no ||
        b.coverage - a.coverage ||
        a.maybe - b.maybe ||
        (b.compatibility ?? 0) - (a.compatibility ?? 0) ||
        (a.date < b.date ? -1 : a.date > b.date ? 1 : 0),
    );
}

/** Há dados para sugerir? Ao menos uma data com cobertura suficiente e alguém disponível. */
export function hasEnoughData(ranked: readonly DateStats[]): boolean {
  return ranked.some((s) => s.sufficient);
}

export type ConfirmationPolicy = 'UNANIMITY' | 'MAJORITY' | 'MANUAL';
export type ConfirmationStatus = 'CONFIRMED' | 'ADJUST' | 'DECLINED';

export interface ConfirmationTally {
  total: number;
  confirmed: number;
  adjust: number;
  declined: number;
  pending: number;
}

export function tallyConfirmations(participantIds: readonly string[], answers: ReadonlyMap<string, ConfirmationStatus>): ConfirmationTally {
  let confirmed = 0, adjust = 0, declined = 0;
  for (const id of participantIds) {
    const a = answers.get(id);
    if (a === 'CONFIRMED') confirmed += 1;
    else if (a === 'ADJUST') adjust += 1;
    else if (a === 'DECLINED') declined += 1;
  }
  const total = participantIds.length;
  return { total, confirmed, adjust, declined, pending: total - confirmed - adjust - declined };
}

/**
 * Resultado da rodada de confirmação:
 * - FINALIZE: a regra foi atendida;
 * - REJECT: não dá mais para atender (unanimidade com alguém que recusou; maioria que já não é possível);
 * - WAIT: segue aberta (na decisão manual, sempre; só o organizador fecha).
 */
export function decideConfirmation(policy: ConfirmationPolicy, t: ConfirmationTally): 'FINALIZE' | 'REJECT' | 'WAIT' {
  if (policy === 'MANUAL') return 'WAIT';
  if (policy === 'UNANIMITY') {
    if (t.confirmed === t.total) return 'FINALIZE';
    return t.declined > 0 ? 'REJECT' : 'WAIT';
  }
  // Maioria: mais da metade de todos os convidados confirmando.
  if (t.confirmed * 2 > t.total) return 'FINALIZE';
  if ((t.confirmed + t.pending) * 2 <= t.total) return 'REJECT';
  return 'WAIT';
}

// ---------- Fuso horário ----------

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetMs(at: Date, timeZone: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const parts: Record<string, number> = {};
  for (const p of f.formatToParts(at)) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  const asUtc = Date.UTC(parts['year']!, parts['month']! - 1, parts['day']!, parts['hour']!, parts['minute']!, parts['second']!);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** Hoje (AAAA-MM-DD) no fuso. */
export function todayIn(timeZone: string, now: Date): string {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(now);
}

/** Instante UTC de um dia e hora ("HH:MM") no relógio do fuso. */
export function zonedTimeToUtc(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMs(new Date(guess), timeZone);
  let utc = guess - first;
  const second = offsetMs(new Date(utc), timeZone);
  if (second !== first) utc = guess - second;
  return new Date(utc);
}
