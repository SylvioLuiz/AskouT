import type { PublicProfile } from './types.ts';

export interface SuggestedPerson extends PublicProfile {
  mutualCount: number;
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
