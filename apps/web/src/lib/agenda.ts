import { t } from '../lib/i18n/index.ts';
import type { CompatibilityLevel, GoingEvent, MeetupView, ParticipantStatus, Slot, SlotState } from './types.ts';

// Tudo aqui trabalha no fuso do aparelho: a pessoa marca "20h" e é isso que ela espera ver.
// A API guarda e devolve instantes em UTC; estas funções fazem a ida e a volta.

/** 'AAAA-MM-DD' no calendário local. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return { y, m, d };
}

/** Soma dias a uma data 'AAAA-MM-DD' sem passar por fuso (não sofre com horário de verão). */
export function addDays(key: string, days: number): string {
  const { y, m, d } = parts(key);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function daysFrom(startKey: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(startKey, i));
}

/** Instante em que começa o dia local `key` (meia-noite local). */
export function startOfDay(key: string): Date {
  const { y, m, d } = parts(key);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/** Período [início do primeiro dia, início do dia seguinte ao último) em ISO/UTC, para consultar a API. */
export function rangeForDays(startKey: string, count: number): { from: string; to: string } {
  return { from: startOfDay(startKey).toISOString(), to: startOfDay(addDays(startKey, count)).toISOString() };
}

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type BuiltSlot = { ok: true; start: string; end: string } | { ok: false; field: 'start' | 'end'; message: string };

/**
 * Monta o horário de um dia a partir de "HH:MM" de início e fim. "00:00" no fim significa meia-noite
 * do dia seguinte (a noite que vai até o fim do dia). Recusa fim antes do início e horários que já passaram.
 */
export function buildSlot(dayKey: string, startHm: string, endHm: string, now: Date): BuiltSlot {
  const s = HM.exec(startHm);
  const e = HM.exec(endHm);
  if (!s) return { ok: false, field: 'start', message: t('Informe a hora de início') };
  if (!e) return { ok: false, field: 'end', message: t('Informe a hora de fim') };
  const { y, m, d } = parts(dayKey);
  const start = new Date(y, m - 1, d, Number(s[1]), Number(s[2]), 0, 0);
  const endMinutes = Number(e[1]) * 60 + Number(e[2]);
  const end = endMinutes === 0 ? new Date(y, m - 1, d + 1, 0, 0, 0, 0) : new Date(y, m - 1, d, Number(e[1]), Number(e[2]), 0, 0);
  if (end.getTime() <= start.getTime()) return { ok: false, field: 'end', message: t('O fim precisa ser depois do início') };
  if (end.getTime() <= now.getTime()) return { ok: false, field: 'start', message: t('Esse horário já passou') };
  return { ok: true, start: start.toISOString(), end: end.toISOString() };
}

/** Horários que tocam o dia local `key`, em ordem de início. */
export function slotsOnDay(slots: readonly Slot[], key: string): Slot[] {
  const dayStart = startOfDay(key).getTime();
  const dayEnd = startOfDay(addDays(key, 1)).getTime();
  return slots
    .filter((slot) => Date.parse(slot.start) < dayEnd && Date.parse(slot.end) > dayStart)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Estados presentes no dia, sem repetir, na ordem disponível, parcial, indisponível (para as marcas da faixa de dias). */
export function statesOnDay(slots: readonly Slot[], key: string): SlotState[] {
  const present = new Set(slotsOnDay(slots, key).map((s) => s.state));
  return (['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'] as const).filter((s) => present.has(s));
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });

function hm(date: Date): string {
  return timeFmt.format(date).replace(/^24:/, '00:');
}

/** "19:00 – 23:00"; avisa quando o horário atravessa a meia-noite. */
export function timeRangeLabel(slot: Pick<Slot, 'start' | 'end'>, dayKey: string): string {
  const start = new Date(slot.start);
  const end = new Date(slot.end);
  const dayStart = startOfDay(dayKey).getTime();
  const dayEnd = startOfDay(addDays(dayKey, 1)).getTime();
  const startsBefore = start.getTime() < dayStart;
  const endsAfter = end.getTime() > dayEnd;
  const from = startsBefore ? '00:00' : hm(start);
  const to = endsAfter ? '24:00' : end.getTime() === dayEnd ? '24:00' : hm(end);
  const note = startsBefore ? ' (começou ontem)' : endsAfter ? ' (continua amanhã)' : '';
  return `${from} – ${to}${note}`;
}

const weekdayShort = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const dayLong = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const instantDay = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' });

function noon(key: string): Date {
  const { y, m, d } = parts(key);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

/** { weekday: 'ter', day: '20' } */
export function dayChip(key: string): { weekday: string; day: string } {
  return { weekday: weekdayShort.format(noon(key)).replace('.', ''), day: String(parts(key).d) };
}

/** "terça-feira, 20 de outubro" */
export function dayLongLabel(key: string): string {
  return dayLong.format(noon(key));
}

/** "ter., 20 de out. · 20:00 – 22:00" no fuso do aparelho. */
export function instantRangeLabel(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  return `${instantDay.format(start)} · ${hm(start)} – ${hm(end)}`;
}

export const STATE_LABEL: Record<SlotState, string> = {
  AVAILABLE: 'Disponível',
  PARTIAL: 'Parcial',
  UNAVAILABLE: 'Indisponível',
};

export const STATE_HELP: Record<SlotState, string> = {
  AVAILABLE: t('Posso aceitar convites neste período'),
  PARTIAL: t('Talvez, só parte do período ou com algum aviso'),
  UNAVAILABLE: t('Não posso, mesmo que alguém convide'),
};

export const LEVEL_LABEL: Record<CompatibilityLevel, string> = {
  green: t('Alta compatibilidade'),
  orange: t('Compatibilidade parcial'),
  red: t('Baixa compatibilidade'),
  awaiting: t('Aguardando informações'),
};

export const PARTICIPANT_LABEL: Record<ParticipantStatus, string> = {
  available: 'Disponível',
  partial: 'Parcial',
  unavailable: 'Indisponível',
  unknown: t('Sem informação'),
};

export interface Preset {
  label: string;
  start: string;
  end: string;
}

export const PRESETS: readonly Preset[] = [
  { label: t('Manhã'), start: '08:00', end: '12:00' },
  { label: t('Tarde'), start: '12:00', end: '18:00' },
  { label: t('Noite'), start: '18:00', end: '00:00' },
];

/** Fuso do aparelho, para pedir à API os horários candidatos no relógio da pessoa. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  } catch {
    return 'America/Sao_Paulo';
  }
}

/** Encontros em que você vai: organiza ou confirmou, e que não foram cancelados. */
export function confirmedMeetups(meetups: readonly MeetupView[]): MeetupView[] {
  return meetups.filter((m) => m.status === 'ACTIVE' && (m.myStatus === 'ORGANIZER' || m.myStatus === 'CONFIRMED'));
}

/** Algo em que você vai e que a agenda marca: encontro confirmado ou evento com "Confirmar presença". */
export interface AgendaEvent {
  key: string;
  title: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  /** Para onde o toque leva. */
  to: string;
}

/** Junta os encontros e os eventos confirmados; quando o encontro é do mesmo evento, fica só o encontro (abre a conversa). */
export function agendaEvents(meetups: readonly MeetupView[], going: readonly GoingEvent[]): AgendaEvent[] {
  const mine = confirmedMeetups(meetups);
  const taken = new Set(mine.flatMap((m) => (m.eventRef ? [m.eventRef] : m.event ? [m.event.id] : [])));
  const fromMeetups = mine.map((m) => ({ key: `m:${m.id}`, title: m.title, startsAt: m.startsAt, endsAt: m.endsAt, venueName: m.event?.venueName ?? null, to: `/conversas/${m.conversationId}` }));
  const fromGoing = going.filter((g) => !taken.has(g.id)).map((g) => ({ key: `e:${g.id}`, title: g.title, startsAt: g.startsAt, endsAt: g.endsAt, venueName: g.venueName, to: `/eventos/${g.id}` }));
  return [...fromMeetups, ...fromGoing];
}

const NIGHT_MS = 6 * 3_600_000;

/** Os que acontecem no dia (data local do aparelho), por horário. Evento de vários dias aparece em todos eles; o que termina de madrugada (até 6h) não invade o dia seguinte. */
export function agendaEventsOnDay(events: readonly AgendaEvent[], key: string): AgendaEvent[] {
  return events
    .filter((e) => {
      const first = localDateKey(new Date(e.startsAt));
      const endMs = Date.parse(e.endsAt) - NIGHT_MS;
      const last = endMs > Date.parse(e.startsAt) ? localDateKey(new Date(endMs)) : first;
      return key >= first && key <= last;
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

/** O próximo plano: o que já começou e ainda não terminou, ou o que vem primeiro. */
export function nextPlan(events: readonly AgendaEvent[], now: Date): AgendaEvent | undefined {
  return [...events]
    .filter((e) => Date.parse(e.endsAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
}

/** "Agora", "Hoje 20h", "Amanhã 20h30", "sáb. 20h" (na semana) ou "25/10 20h". */
export function planWhenLabel(event: Pick<AgendaEvent, 'startsAt'>, now: Date): string {
  const start = new Date(event.startsAt);
  const hm = `${start.getHours()}h${start.getMinutes() === 0 ? '' : String(start.getMinutes()).padStart(2, '0')}`;
  if (start.getTime() <= now.getTime()) return 'Agora';
  const today = localDateKey(now);
  const key = localDateKey(start);
  if (key === today) return t('Hoje {hm}', { hm });
  if (key === addDays(today, 1)) return t('Amanhã {hm}', { hm });
  if (key < addDays(today, 7)) return `${start.toLocaleDateString('pt-BR', { weekday: 'short' })} ${hm}`;
  return `${String(start.getDate()).padStart(2, '0')}/${String(start.getMonth() + 1).padStart(2, '0')} ${hm}`;
}
