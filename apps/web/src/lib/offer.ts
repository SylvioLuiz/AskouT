import { intlLocale, t } from './i18n/index.ts';

/** Durações oferecidas ao responsável, em minutos (o servidor aceita de 15 min a 4 h). */
export const OFFER_DURATION_CHOICES: readonly number[] = [30, 60, 120, 180, 240];

/** A oferta ainda vale em `now`? (Some sozinha ao vencer, sem esperar a próxima consulta.) */
export function offerIsLive(offer: { endsAt: string }, now: Date): boolean {
  const end = Date.parse(offer.endsAt);
  return Number.isFinite(end) && end > now.getTime();
}

/** “até 22:00”. */
export function offerUntil(endsAt: string): string {
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return '';
  return t('até {time}', { time: d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }) });
}

export function offerDurationLabel(minutes: number): string {
  if (minutes < 60) return t('{n} min', { n: minutes });
  const hours = minutes / 60;
  return Number.isInteger(hours) ? (hours === 1 ? t('1 hora') : t('{n} horas', { n: hours })) : t('{n} min', { n: minutes });
}
