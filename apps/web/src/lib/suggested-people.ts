import { t } from './i18n/index.ts';
import type { PublicProfile } from './types.ts';

/** Por que a pessoa foi sugerida (o motivo que mais pesou no servidor). */
export type SuggestionReason = 'MUTUAL' | 'FOLLOWS_YOU' | 'EVENTS' | 'TASTES';

export interface SuggestedPerson extends PublicProfile {
  mutualCount: number;
  /** Ausentes em versões antigas da API. */
  sharedEvents?: number;
  followsYou?: boolean;
  sharedTastes?: number;
  reason?: SuggestionReason;
}

/** Frase curta do cartão: o motivo principal, com o número quando houver. Versão antiga da API cai em amigos em comum. */
export function suggestionReasonText(p: SuggestedPerson): string {
  const reason = p.reason ?? 'MUTUAL';
  if (reason === 'FOLLOWS_YOU') return t('Segue você');
  if (reason === 'EVENTS') {
    const n = p.sharedEvents ?? 0;
    return n === 1 ? t('1 local em comum') : t('{n} locais em comum', { n });
  }
  if (reason === 'TASTES') return t('Curte rolês parecidos');
  return p.mutualCount === 1 ? t('1 amigo em comum') : t('{n} amigos em comum', { n: p.mutualCount });
}

/** Quanto tempo o bloco fica escondido depois que a pessoa toca em "Ocultar". */
export const SUGGESTION_HIDE_MS = 3 * 24 * 3_600_000;
const KEY = 'askout.suggestedPeople.hiddenAt';

/** O bloco aparece sempre que há sugestões; só some por 3 dias quando a pessoa o oculta. */
export function shouldShowSuggestions(hiddenAt: number | null, now: number): boolean {
  if (hiddenAt === null || !Number.isFinite(hiddenAt)) return true;
  return now - hiddenAt >= SUGGESTION_HIDE_MS;
}

export function readHiddenAt(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

export function markHidden(now: number): void {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // sem armazenamento: o bloco some só nesta visita
  }
}
