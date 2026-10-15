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
}

export interface PollInput {
  conversationId: string;
  title: string;
  rangeStart: string;
  rangeEnd: string;
  durationMinutes: number;
  preferredTimeStart?: string;
  votingDeadline?: string;
  confirmationPolicy: Policy;
}

export const VOTE_LABEL: Record<VoteStatus, string> = { YES: 'Posso', MAYBE: 'Talvez', NO: 'Não posso' };
/** Sinal além da cor, para quem não distingue cores. */
export const VOTE_MARK: Record<VoteStatus, string> = { YES: '✓', MAYBE: '?', NO: '✕' };
export const LEVEL_LABEL: Record<Level, string> = { GREEN: 'Alta', ORANGE: 'Média', RED: 'Baixa', GRAY: 'Poucos votos' };
export const POLICY_LABEL: Record<Policy, string> = { UNANIMITY: 'Unanimidade', MAJORITY: 'Maioria', MANUAL: 'Decisão do organizador' };
export const POLICY_HINT: Record<Policy, string> = {
  UNANIMITY: 'Fecha quando todos confirmam; uma recusa derruba a data.',
  MAJORITY: 'Fecha quando mais da metade confirma.',
  MANUAL: 'Você fecha a data quando quiser.',
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

/** Linha fixa da conversa: "Nome · em votação: 50% dos votos" ou "Nome · marcado para sexta-feira, 24/10". Nula quando não há o que mostrar. */
export function pollLine(p: PollSummary, now: Date): string | null {
  if (p.status === 'CANCELLED') return null;
  if (p.status === 'FINALIZED') {
    if (!p.finalDate || (p.finalEndsAt && new Date(p.finalEndsAt).getTime() < now.getTime())) return null;
    return `${p.title} · marcado para ${weekdayName(p.finalDate)}, ${shortDay(p.finalDate)}`;
  }
  if (p.status === 'CONFIRMING') return `${p.title} · confirmando ${p.proposedDate ? shortDay(p.proposedDate) : 'a data'}`;
  const share = p.participantCount > 0 ? Math.round((p.votedCount / p.participantCount) * 100) : 0;
  return `${p.title} · em votação: ${share}% dos votos`;
}
