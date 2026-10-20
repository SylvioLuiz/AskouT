import type { GroupDateFit } from './types.ts';

/** Mesmo limite do servidor: você mais até 9 amigos. */
export const GROUP_MAX_FRIENDS = 9;

/** Marca ou desmarca uma pessoa; passa do limite, a lista fica como estava. */
export function togglePerson(selected: readonly string[], id: string, max = GROUP_MAX_FRIENDS): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return selected.length >= max ? [...selected] : [...selected, id];
}

export const DATE_FIT_LABEL: Record<GroupDateFit, string> = {
  ALL_FREE: 'Dia livre para todos',
  MOST_FREE: 'Dá para todos, alguns só em parte',
  UNKNOWN: 'Ninguém marcou que está ocupado',
};

export const PERIOD_OPTIONS = [7, 14, 30] as const;

/** Nota de 0 a 100 em palavras, para não depender só do número. */
export function scoreLabel(score: number): string {
  if (score >= 80) return 'Tudo a ver';
  if (score >= 60) return 'Combina bem';
  return 'Vale a ideia';
}
