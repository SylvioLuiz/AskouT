import { timeAgo } from './format.ts';
import type { VenueEventDraft } from './venue.ts';
import { draftFromEvent } from './venue.ts';
import type { CalendarDraft, CalendarInfo } from './types.ts';

/** Iguais aos limites da API. */
export const CALENDAR_LEAD_MIN = 1;
export const CALENDAR_LEAD_MAX = 30;
export const CALENDAR_LEAD_DEFAULT = 7;
export const CALENDAR_LEAD_VALUES: readonly number[] = Array.from({ length: CALENDAR_LEAD_MAX }, (_, i) => i + CALENDAR_LEAD_MIN);

export function leadLabel(days: number): string {
  return days === 1 ? '1 dia' : `${days} dias`;
}

/** Problema no endereço colado, ou null. A API confere de novo e abre a agenda de verdade. */
export function calendarUrlProblem(raw: string): string | null {
  const v = raw.trim();
  if (v === '') return 'Cole o endereço da agenda.';
  if (v.length > 500) return 'O endereço é grande demais.';
  if (!/^(https|webcal):\/\/\S+$/i.test(v)) return 'Use o endereço completo, começando com https:// ou webcal://';
  return null;
}

const DAY = 24 * 3_600_000;
const clock = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayName = (d: Date) => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }).replace(',', '');

/** Quando o evento sobe: "hoje às 14:00", "amanhã às 09:00", "qui. 29/10 às 09:00" ou, se a data já passou, "assim que você aprovar". */
export function publishLabel(publishAt: string, now: Date): string {
  const at = new Date(publishAt);
  if (at.getTime() <= now.getTime()) return 'assim que você aprovar';
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(at, now)) return `hoje às ${clock(at)}`;
  if (sameDay(at, new Date(now.getTime() + DAY))) return `amanhã às ${clock(at)}`;
  return `${dayName(at)} às ${clock(at)}`;
}

export function draftStatusLabel(status: CalendarDraft['status']): string {
  switch (status) {
    case 'APPROVED':
      return 'Aprovado';
    case 'AWAITING':
      return 'Esperando sua aprovação';
    default:
      return 'Ainda não chegou a hora de aprovar';
  }
}

/** Frase sobre a última leitura da agenda. */
export function syncLabel(c: CalendarInfo, now: Date): string {
  if (c.lastError) return c.lastError;
  if (!c.lastSyncAt) return 'Ainda não foi lida.';
  const found = c.lastFound === 0 ? 'nenhum evento novo à vista' : c.lastFound === 1 ? '1 evento à vista' : `${c.lastFound} eventos à vista`;
  return `Lida ${timeAgo(c.lastSyncAt, now)} · ${found}`;
}

/** Os dados do rascunho no formato do formulário de evento. */
export function eventDraftOf(d: CalendarDraft, isoToLocalInput: (iso: string) => string): VenueEventDraft {
  return draftFromEvent({ id: d.id, title: d.title, description: d.description === '' ? null : d.description, kind: d.kind, startsAt: d.startsAt, endsAt: d.endsAt, isFree: d.isFree, imageUrl: d.imageUrl, tags: d.tags, ticketUrl: d.ticketUrl, phase: 'UPCOMING', sample: false }, isoToLocalInput);
}
