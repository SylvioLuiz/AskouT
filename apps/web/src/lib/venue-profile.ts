import type { VenueDayHours, VenueHours, VenueProfile, VenueProfileBody } from './types.ts';

/** Iguais aos limites da API. */
export const VENUE_NAME_MAX = 80;
export const VENUE_NAME_MIN = 2;
export const VENUE_ADDRESS_MAX = 200;
export const VENUE_CATEGORY_MAX = 40;
export const VENUE_DESCRIPTION_MAX = 600;
export const VENUE_POST_CAPTION_MAX = 500;
export const VENUE_POST_PHOTOS_MAX = 5;

export const DAY_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const;
export const DAY_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;
/** Ordem de exibição: a semana começa na segunda. */
export const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const WEEK = 7 * 1440;

/** Quanto o expediente de um dia dura; fechar em hora igual ou menor que a de abrir passa da meia-noite. */
function span(day: VenueDayHours): number {
  const open = toMin(day.open);
  const close = toMin(day.close);
  return close > open ? close - open : 1440 - open + close;
}

export interface OpenStatus {
  open: boolean;
  /** "Aberto agora · fecha às 02:00" ou "Fechado · abre hoje às 18:00". */
  label: string;
}

/** Estado de funcionamento no horário local do aparelho. `null` se o bar não informou horários. */
export function openStatus(hours: VenueHours | null, now: Date): OpenStatus | null {
  if (!hours || hours.length !== 7 || hours.every((d) => d === null)) return null;
  const nowMin = now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  let next: { start: number; day: number; time: string } | undefined;
  for (let d = 0; d < 7; d += 1) {
    const day = hours[d];
    if (!day) continue;
    const base = d * 1440 + toMin(day.open);
    const length = span(day);
    // O expediente de sábado pode entrar pelo domingo (semana anterior): confere também a semana passada.
    if ([-WEEK, 0].some((shift) => nowMin >= base + shift && nowMin < base + shift + length)) return { open: true, label: `Aberto agora · fecha às ${day.close}` };
    for (const start of [base, base + WEEK]) if (start > nowMin && (!next || start < next.start)) next = { start, day: d, time: day.open };
  }
  if (!next) return { open: false, label: 'Fechado' };
  const diffDays = Math.floor(next.start / 1440) - now.getDay();
  const when = diffDays === 0 ? 'hoje' : diffDays === 1 ? 'amanhã' : DAY_LONG[next.day]!;
  return { open: false, label: `Fechado · abre ${when} às ${next.time}` };
}

export interface HoursLine {
  day: number;
  label: string;
  text: string;
  today: boolean;
}

/** Linhas para mostrar na página, da segunda ao domingo. */
export function hoursLines(hours: VenueHours | null, now: Date): HoursLine[] {
  if (!hours) return [];
  return DISPLAY_ORDER.map((d) => {
    const h = hours[d];
    return { day: d, label: DAY_SHORT[d]!, text: h ? `${h.open} às ${h.close}` : 'Fechado', today: d === now.getDay() };
  });
}

// ---------- edição do perfil ----------

export interface DayDraft {
  open: boolean;
  from: string;
  to: string;
}

export interface VenueProfileDraft {
  name: string;
  address: string;
  category: string;
  description: string;
  days: DayDraft[];
  imageUrl: string;
  imageData: string;
}

const DEFAULT_DAY: DayDraft = { open: false, from: '18:00', to: '23:00' };

export function draftFromProfile(v: VenueProfile): VenueProfileDraft {
  return {
    name: v.name,
    address: v.address ?? '',
    category: v.category ?? '',
    description: v.description ?? '',
    days: Array.from({ length: 7 }, (_, d) => {
      const h = v.hours?.[d];
      return h ? { open: true, from: h.open, to: h.close } : { ...DEFAULT_DAY };
    }),
    imageUrl: v.coverUrl ?? '',
    imageData: '',
  };
}

const HOUR_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function profileProblem(d: VenueProfileDraft): string | null {
  const name = d.name.trim();
  if (Array.from(name).length < VENUE_NAME_MIN) return `O nome precisa de pelo menos ${VENUE_NAME_MIN} caracteres.`;
  if (Array.from(name).length > VENUE_NAME_MAX) return `O nome pode ter até ${VENUE_NAME_MAX} caracteres.`;
  if (Array.from(d.address.trim()).length > VENUE_ADDRESS_MAX) return `O endereço pode ter até ${VENUE_ADDRESS_MAX} caracteres.`;
  if (Array.from(d.category.trim()).length > VENUE_CATEGORY_MAX) return `A categoria pode ter até ${VENUE_CATEGORY_MAX} caracteres.`;
  if (Array.from(d.description.trim()).length > VENUE_DESCRIPTION_MAX) return `A descrição pode ter até ${VENUE_DESCRIPTION_MAX} caracteres.`;
  for (let i = 0; i < 7; i += 1) {
    const day = d.days[i]!;
    if (!day.open) continue;
    if (!HOUR_RE.test(day.from) || !HOUR_RE.test(day.to)) return `Informe a hora de abrir e fechar de ${DAY_LONG[i]}.`;
    if (day.from === day.to) return `Em ${DAY_LONG[i]}, abrir e fechar não podem ser na mesma hora.`;
  }
  return null;
}

export function profileBody(d: VenueProfileDraft): VenueProfileBody {
  const days = d.days.map((day): VenueDayHours | null => (day.open ? { open: day.from, close: day.to } : null));
  const text = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    name: d.name.trim(),
    address: text(d.address),
    category: text(d.category),
    description: text(d.description),
    hours: days.every((x) => x === null) ? null : days,
    ...(d.imageData !== '' ? { imageData: d.imageData } : { imageUrl: d.imageUrl.trim() === '' ? null : d.imageUrl.trim() }),
  };
}

/** Copia o horário de um dia para todos os outros (abre os dias que estavam fechados). */
export function applyToAll(days: DayDraft[], from: number): DayDraft[] {
  const base = days[from]!;
  return days.map(() => ({ open: base.open, from: base.from, to: base.to }));
}
