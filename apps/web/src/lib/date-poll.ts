import { t } from '../lib/i18n/index.ts';
import type { PublicProfile } from './types.ts';

export type VoteStatus = 'YES' | 'MAYBE' | 'NO';
export type Level = 'GREEN' | 'ORANGE' | 'RED' | 'GRAY';
export type Policy = 'UNANIMITY' | 'MAJORITY' | 'MANUAL';
export type PollStatus = 'VOTING' | 'CONFIRMING' | 'FINALIZED' | 'CANCELLED';
export type ConfirmationAnswer = 'CONFIRMED' | 'ADJUST' | 'DECLINED';

export interface DateStats {
  date: string;
  yes: number;
  maybe: number;
  no: number;
  answered: number;
  unanswered: number;
  eligible: number;
  compatibility: number | null;
  coverage: number;
  level: Level;
  lowCoverage: boolean;
}

export interface ProposalView {
  id: string;
  date: string;
  startsAt: string;
  endsAt: string;
  status: string;
  compatibility: number | null;
  coverage: number;
  yes: number;
  maybe: number;
  no: number;
  unanswered: number;
}

export interface PollView {
  id: string;
  conversationId: string;
  conversationName: string | null;
  isGroup: boolean;
  title: string;
  status: PollStatus;
  organizer: PublicProfile;
  isOrganizer: boolean;
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  preferredTimeStart: string | null;
  timezone: string;
  votingDeadline: string | null;
  votingOpen: boolean;
  votingClosed: boolean;
  canClose: boolean;
  confirmationPolicy: Policy;
  thresholds: { green: number; orange: number; minCoverage: number };
  participants: { profile: PublicProfile; finished: boolean; confirmation: ConfirmationAnswer | null }[];
  days: DateStats[];
  myVotes: Record<string, VoteStatus>;
  iFinished: boolean;
  ranking: DateStats[];
  enoughData: boolean;
  proposal: (ProposalView & { tally: { confirmed: number; adjust: number; declined: number; pending: number; total: number }; myConfirmation: ConfirmationAnswer | null }) | null;
  history: ProposalView[];
  final: { date: string; startsAt: string; endsAt: string; meetupId: string | null } | null;
  createdAt: string;
}

export interface PollSummary {
  id: string;
  conversationId: string;
  title: string;
  status: PollStatus;
  rangeStart: string;
  rangeEnd: string;
  finalDate: string | null;
  needsMyVote: boolean;
  needsMyConfirmation: boolean;
  participantCount: number;
  votedCount: number;
  finalEndsAt: string | null;
  finishedCount: number;
  best: { date: string; compatibility: number | null; coverage: number } | null;
  proposedDate: string | null;
  votingDeadline: string | null;
  meetupId: string | null;
  /** Evento criado a partir da votação: ele substitui a votação nas listas do grupo. */
  event: { id: string; title: string; startsAt: string; endsAt: string } | null;
}

export interface PollInput {
  conversationId: string;
  title: string;
  rangeStart: string;
  rangeEnd: string;
  durationMinutes?: number;
  preferredTimeStart?: string;
  votingDeadline?: string;
  confirmationPolicy: Policy;
}

export const VOTE_LABEL: Record<VoteStatus, string> = { YES: 'Posso', MAYBE: 'Talvez', NO: t('Não posso') };
/** Sinal além da cor, para quem não distingue cores. */
export const VOTE_MARK: Record<VoteStatus, string> = { YES: '✓', MAYBE: '?', NO: '✕' };
export const LEVEL_LABEL: Record<Level, string> = { GREEN: 'Alta', ORANGE: 'Média', RED: 'Baixa', GRAY: t('Poucos votos') };
export const POLICY_LABEL: Record<Policy, string> = { UNANIMITY: 'Unanimidade', MAJORITY: 'Maioria', MANUAL: t('Decisão do organizador') };
export const POLICY_HINT: Record<Policy, string> = {
  UNANIMITY: t('Fecha quando todos confirmam; uma recusa derruba a data.'),
  MAJORITY: t('Fecha quando mais da metade confirma.'),
  MANUAL: t('Você fecha a data quando quiser.'),
};

const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Dia da semana (0 = domingo) de um AAAA-MM-DD, sem depender do fuso do aparelho. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export function weekdayName(day: string): string {
  return WEEKDAYS[weekdayOf(day)]!;
}

export function shortDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

export function longDay(day: string): string {
  return `${weekdayName(day)}, ${Number(day.slice(8, 10))} de ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
}

export function monthTitle(day: string): string {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} de ${day.slice(0, 4)}`;
}

/** Semanas (domingo a sábado) que cobrem o intervalo, com `null` fora dele. */
export function calendarWeeks(start: string, end: string): (string | null)[][] {
  const first = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  const cursor = new Date(first.getTime() - first.getUTCDay() * 86_400_000);
  const weeks: (string | null)[][] = [];
  while (cursor <= last) {
    const week: (string | null)[] = [];
    for (let i = 0; i < 7; i += 1) {
      const iso = cursor.toISOString().slice(0, 10);
      week.push(iso >= start && iso <= end ? iso : null);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function percent(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`;
}

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** Texto lido por leitores de tela para uma célula do calendário. */
export function cellLabel(stats: DateStats, mine: VoteStatus | undefined): string {
  const parts = [longDay(stats.date), mine ? `sua resposta: ${VOTE_LABEL[mine]}` : 'sem resposta sua'];
  parts.push(stats.compatibility === null ? 'sem votos' : `${percent(stats.compatibility)} de compatibilidade, ${percent(stats.coverage)} votaram`);
  return parts.join(', ');
}

/** Linha fixa da conversa: nome à esquerda e o andamento à direita ("em votação: 75% dos votos", "marcado para sábado, 24/10"). Nula quando não há o que mostrar. */
export function pollLine(p: PollSummary, now: Date): { name: string; status: string } | null {
  if (p.status === 'CANCELLED') return null;
  if (p.status === 'FINALIZED') {
    if (!p.finalDate || (p.finalEndsAt && new Date(p.finalEndsAt).getTime() < now.getTime())) return null;
    return { name: p.title, status: `marcado para ${weekdayName(p.finalDate)}, ${shortDay(p.finalDate)}` };
  }
  if (p.status === 'CONFIRMING') return { name: p.title, status: `confirmando ${p.proposedDate ? shortDay(p.proposedDate) : 'a data'}` };
  const share = p.participantCount > 0 ? Math.round((p.votedCount / p.participantCount) * 100) : 0;
  return { name: p.title, status: `em votação: ${share}% dos votos` };
}

/** Dia (AAAA-MM-DD) de um instante no fuso da votação. */
export function dayInZone(iso: string, timeZone = 'America/Sao_Paulo'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

/** Com um evento escolhido, o período não passa do dia dele: devolve início e fim ajustados. */
export function clampRange(start: string, end: string, lastDay: string | undefined): { start: string; end: string } {
  if (!lastDay) return { start, end };
  const s = start !== '' && start > lastDay ? lastDay : start;
  const e = end !== '' && end > lastDay ? lastDay : end;
  return { start: s, end: e };
}

/** Dias em que um evento acontece (da data de início à de término, no fuso dado). Evento de um dia só devolve start = end; o que termina de madrugada conta como a noite do dia de início. Evento que já começou parte de hoje. */
export function eventDays(startsAt: string, endsAt: string | null | undefined, today: string, timeZone?: string): { start: string; end: string } {
  const first = dayInZone(startsAt, timeZone);
  // Termina de madrugada (até 6h): ainda é a noite do dia de início.
  const last = endsAt ? dayInZone(new Date(new Date(endsAt).getTime() - 6 * 3_600_000).toISOString(), timeZone) : first;
  const end = last < first ? first : last;
  const start = first < today && end >= today ? today : first;
  return { start, end };
}

const MONTHS_SHORT = ['jan.', 'fev.', 'mar.', 'abr.', 'mai.', 'jun.', 'jul.', 'ago.', 'set.', 'out.', 'nov.', 'dez.'];

/** "2026-10-20" -> "20 de out.". */
export function chipDay(day: string): string {
  return `${Number(day.slice(8, 10))} de ${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]}`;
}

/** Semanas (domingo a sábado) de um mês (`month` de 1 a 12), com `null` fora dele. */
export function monthWeeks(year: number, month: number): (string | null)[][] {
  const pad = (n: number) => String(n).padStart(2, '0');
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= count; d += 1) cells.push(`${year}-${pad(month)}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Soma `delta` meses a (ano, mês 1-12). */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Parte do dia escolhida na criação da votação -> horário usado ao propor a data. */
export type DaySlot = 'MORNING' | 'AFTERNOON' | 'NIGHT';
export const SLOT_TIME: Record<DaySlot, string> = { MORNING: '09:00', AFTERNOON: '14:00', NIGHT: '19:00' };

const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "2026-10-24" -> "Sáb, 24 out" (rótulo curto do pódio). */
export function podiumDay(day: string): string {
  return `${WEEKDAYS_SHORT[weekdayOf(day)]}, ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]!.slice(0, 3)}`;
}
