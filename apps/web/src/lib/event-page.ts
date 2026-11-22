// Contas da página do evento que não dependem de tela.
import type { EventPage } from './types.ts';
import { intlLocale } from '../lib/i18n/index.ts';
import { t } from '../lib/i18n/index.ts';

const dayMonthParts = new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short' });
/** "17 out" (curto, para caber nas colunas). */
const dayMonth = { format: (d: Date) => dayMonthParts.formatToParts(d).filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.value.replace('.', '')).join(' ') };
const weekday = { format: (d: Date) => new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' }).format(d).replace('.', '') };
const clock = new Intl.DateTimeFormat(intlLocale(), { hour: '2-digit', minute: '2-digit', hour12: false });

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "sáb., 17 out." e, quando termina em outro dia, "17 out. – 19 out.". */
/** Evento de pessoa sem data ainda: o dia sai de uma votação. */
export const dateByPollLabel = (): string => t('Data em votação');

export function eventDateLabel(startsAt: string | null, endsAt: string | null): { main: string; sub: string | null } {
  if (startsAt === null) return { main: t('Em votação'), sub: null };
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return { main: '—', sub: null };
  const end = new Date(endsAt ?? '');
  const multi = !Number.isNaN(end.getTime()) && !sameDay(start, end);
  return { main: dayMonth.format(start), sub: multi ? t('até {day}', { day: dayMonth.format(end) }) : weekday.format(start) };
}

/** "20:00" e, quando termina no mesmo dia, "até 23:00". */
export function eventTimeLabel(startsAt: string | null, endsAt: string | null): { main: string; sub: string | null } {
  if (startsAt === null) return { main: t('A definir'), sub: null };
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return { main: '—', sub: null };
  const end = new Date(endsAt ?? '');
  const sameDayEnd = !Number.isNaN(end.getTime()) && sameDay(start, end);
  return { main: clock.format(start), sub: sameDayEnd ? t('até {time}', { time: clock.format(end) }) : null };
}

const longDay = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });

/** "sábado, 28 de novembro" e, quando termina em outro dia, "28 nov – 30 nov". */
export function eventLongDate(startsAt: string | null, endsAt: string | null): string {
  if (startsAt === null) return dateByPollLabel();
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return '—';
  const end = new Date(endsAt ?? '');
  if (!Number.isNaN(end.getTime()) && !sameDay(start, end)) return `${dayMonth.format(start)} – ${dayMonth.format(end)}`;
  const text = longDay.format(start);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Texto do endereço do evento: lugar e, se houver, o endereço. */
export function venueLine(venue: EventPage['venue']): string {
  return venue.address ? `${venue.name} · ${venue.address}` : venue.name;
}

/** Quem aparece na fileira de avatares e quantos ficam de fora ("+3"). */
export function attendeeStrip<T>(attendees: readonly T[], total: number, max: number): { shown: T[]; more: number } {
  const shown = attendees.slice(0, max);
  return { shown, more: Math.max(0, total - shown.length) };
}

export function eventLink(origin: string, eventId: string): string {
  return `${origin}/eventos/${encodeURIComponent(eventId)}`;
}

/** Local resumido para a capa: nome do lugar + só o começo do endereço (rua e número). */
export function venueShort(venue: EventPage['venue']): string {
  const street = venue.address ? (venue.address.split(',')[0] ?? '').trim() : '';
  return [venue.name, street].filter(Boolean).join(' · ');
}
