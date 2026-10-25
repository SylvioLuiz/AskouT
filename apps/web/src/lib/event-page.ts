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
export function eventDateLabel(startsAt: string, endsAt: string): { main: string; sub: string | null } {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return { main: '—', sub: null };
  const end = new Date(endsAt);
  const multi = !Number.isNaN(end.getTime()) && !sameDay(start, end);
  return { main: dayMonth.format(start), sub: multi ? t('até {day}', { day: dayMonth.format(end) }) : weekday.format(start) };
}

/** "20:00" e, quando termina no mesmo dia, "até 23:00". */
export function eventTimeLabel(startsAt: string, endsAt: string): { main: string; sub: string | null } {
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return { main: '—', sub: null };
  const end = new Date(endsAt);
  const sameDayEnd = !Number.isNaN(end.getTime()) && sameDay(start, end);
  return { main: clock.format(start), sub: sameDayEnd ? t('até {time}', { time: clock.format(end) }) : null };
}

/** Texto do endereço do evento: lugar e, se houver, o endereço. */
export function venueLine(venue: EventPage['venue']): string {
  return venue.address ? `${venue.name} · ${venue.address}` : venue.name;
}

/** Link para abrir o lugar no mapa: com coordenadas, pelo ponto; sem elas (evento de pessoa), pela busca do nome. */
export function venueMapLink(venue: EventPage['venue']): string {
  if (venue.lat !== null && venue.lng !== null) return `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lng}`;
  const query = venue.address ? `${venue.name}, ${venue.address}` : venue.name;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Quem aparece na fileira de avatares e quantos ficam de fora ("+3"). */
export function attendeeStrip<T>(attendees: readonly T[], total: number, max: number): { shown: T[]; more: number } {
  const shown = attendees.slice(0, max);
  return { shown, more: Math.max(0, total - shown.length) };
}

export function eventLink(origin: string, eventId: string): string {
  return `${origin}/eventos/${encodeURIComponent(eventId)}`;
}
