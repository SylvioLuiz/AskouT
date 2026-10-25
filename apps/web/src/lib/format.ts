import { intlLocale, t } from '../lib/i18n/index.ts';
const compact = new Intl.NumberFormat(intlLocale(), { notation: 'compact', maximumFractionDigits: 1 });

/** 950 -> "950"; 1200 -> "1,2 mil". */
export function formatCount(value: number): string {
  return compact.format(value);
}

/** Segundos inteiros até o instante `iso`, nunca negativos. */
export function secondsUntil(iso: string, nowMs: number): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - nowMs) / 1000));
}

/** 75 -> "1:15"; 9 -> "0:09". */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** "agora", "há 5 min", "há 3 h", "há 2 dias" ou a data, para posts. */
export function timeAgo(iso: string, now: Date): string {
  const diff = Math.max(0, now.getTime() - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('agora');
  if (min < 60) return t('há {min} min', { min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('há {h} h', { h });
  const d = Math.floor(h / 24);
  if (d < 7) return d === 1 ? t('há 1 dia') : t('há {d} dias', { d });
  return new Date(iso).toLocaleDateString(intlLocale(), { day: '2-digit', month: 'short' });
}
