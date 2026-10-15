import type { PublicProfile } from './types.ts';

export interface SuggestedPerson extends PublicProfile {
  mutualCount: number;
}

export const SUGGESTION_EVERY_MS = 3 * 24 * 3_600_000;
export const SUGGESTION_MIN_FOLLOWING = 5;
const KEY = 'askout.suggestedPeople.shownAt';

/** Quem segue menos de 5 pessoas vê o bloco sempre; depois, só de 3 em 3 dias. */
export function shouldShowSuggestions(followingCount: number, lastShownAt: number | null, now: number): boolean {
  if (followingCount < SUGGESTION_MIN_FOLLOWING) return true;
  if (lastShownAt === null || !Number.isFinite(lastShownAt)) return true;
  return now - lastShownAt >= SUGGESTION_EVERY_MS;
}

export function readLastShown(): number | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
}

export function markShown(now: number): void {
  try {
    localStorage.setItem(KEY, String(now));
  } catch {
    // sem armazenamento: o bloco só aparece com a regra de quem segue pouca gente
  }
}
