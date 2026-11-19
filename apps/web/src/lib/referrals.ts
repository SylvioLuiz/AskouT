import { t } from './i18n/index.ts';
import type { ReferralOverview } from './types.ts';

/** "Você trouxe N amigos" (no singular com 1). */
export function broughtText(count: number): string {
  return count === 1 ? t('Você trouxe {n} amigo', { n: count }) : t('Você trouxe {n} amigos', { n: count });
}

/** Progresso do selo: só convites confirmados (a pessoa voltou ao app em outro dia) contam. */
export function badgeProgressText(o: Pick<ReferralOverview, 'confirmed' | 'badgeThreshold' | 'badgeEarned'>): string {
  if (o.badgeEarned) return t('Você ganhou o selo "Trouxe a galera"!');
  return t('{confirmed} de {threshold} amigos já voltaram ao app. Com {threshold} ganha o selo "Trouxe a galera".', { confirmed: o.confirmed, threshold: o.badgeThreshold });
}
