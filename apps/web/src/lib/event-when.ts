import { intlLocale, t } from './i18n/index.ts';

/** Atalhos de horário na folha "Quando" da criação de evento. */
export const QUICK_TIMES = ['12:00', '14:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'] as const;

/** Quantos dias aparecem como atalho (hoje e os próximos). */
export const QUICK_DAYS = 14;

const pad = (n: number) => String(n).padStart(2, '0');

/** Data local do aparelho no formato de `<input type="date">` (AAAA-MM-DD). */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Separa o valor de `<input type="datetime-local">` em dia e hora. Valor inválido vira vazio. */
export function splitLocal(value: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
  return m ? { date: m[1]!, time: m[2]! } : { date: '', time: '' };
}

/** Junta dia e hora no formato de `<input type="datetime-local">`. Falta um dos dois: vazio. */
export function joinLocal(date: string, time: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? `${date}T${time}` : '';
}

/** Soma horas a um valor datetime-local (hora do aparelho). */
export function addHoursLocal(value: string, hours: number): string {
  const { date, time } = splitLocal(value);
  if (!date) return '';
  const d = new Date(`${date}T${time}`);
  d.setHours(d.getHours() + hours);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface QuickDay {
  /** AAAA-MM-DD */
  value: string;
  /** "Hoje", "Amanhã" ou o dia da semana curto ("sáb"). */
  top: string;
  /** Dia do mês. */
  day: number;
  /** Nome completo para leitores de tela ("sábado, 22 de novembro"). */
  label: string;
}

/** Hoje e os próximos dias, para os botões de dia. */
export function upcomingDays(now: Date, count = QUICK_DAYS): QuickDay[] {
  const weekday = new Intl.DateTimeFormat(intlLocale(), { weekday: 'short' });
  const full = new Intl.DateTimeFormat(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' });
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const top = i === 0 ? t('Hoje') : i === 1 ? t('Amanhã') : weekday.format(d).replace('.', '');
    return { value: localDate(d), top, day: d.getDate(), label: i < 2 ? `${top}, ${full.format(d)}` : full.format(d) };
  });
}

/** Resumo da linha "Quando": "hoje · 22:00", "sáb, 22 de nov. · 22:00", com o término se houver. */
export function whenLabel(starts: string, ends: string, now: Date): string {
  const s = splitLocal(starts);
  if (!s.date) return '';
  const today = localDate(now);
  const tomorrow = localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const day =
    s.date === today
      ? t('hoje')
      : s.date === tomorrow
        ? t('amanhã')
        : new Intl.DateTimeFormat(intlLocale(), { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${s.date}T12:00`)).replace(/\./g, '');
  const e = splitLocal(ends);
  if (!e.date) return `${day} · ${s.time}`;
  return e.date === s.date ? `${day} · ${s.time}–${e.time}` : `${day} · ${s.time} ${t('até')} ${e.time}`;
}

/**
 * O término acompanha o início: mudou o início, o término anda o mesmo tanto (a duração fica igual).
 * Sem término, ou com um dos valores inválido, devolve o término como estava. O término continua editável à parte.
 */
export function followStart(previousStart: string, nextStart: string, end: string): string {
  if (!end || !previousStart || !nextStart) return end;
  const before = new Date(previousStart).getTime();
  const after = new Date(nextStart).getTime();
  const { date, time } = splitLocal(end);
  if (!date || Number.isNaN(before) || Number.isNaN(after)) return end;
  const d = new Date(new Date(`${date}T${time}`).getTime() + (after - before));
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
