import type { EventKind } from './types.ts';

/** Os temas de rolê do lançamento. Para abrir outro (cinema, parques…), basta incluir aqui. */
export type ThemeId = 'BAR' | 'NIGHT';

export interface Theme {
  id: ThemeId;
  label: string;
  hint: string;
  /** Casa com o tipo do local (texto livre do dono ou tipo vindo do Google/OpenStreetMap). */
  category: RegExp;
}

export const THEMES: readonly Theme[] = [
  { id: 'BAR', label: 'Bares', hint: 'Boteco, pub, música ao vivo, happy hour', category: /\b(bar|pub|boteco|botequim|choperia|cervejaria|biergarten|casa de shows?|samba)\b|bar_|_bar/i },
  { id: 'NIGHT', label: 'Baladas', hint: 'Balada, festa, pista, noite', category: /night|balada|boate|danceteria|\bclub\b|club\b|festa|casa noturna/i },
];

const NIGHT_KINDS: readonly EventKind[] = ['NIGHT'];

export function themeLabel(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.label ?? '';
}

/** Tema de um local pelo tipo. Balada ganha de bar (“bar e balada” é balada). */
export function themeOfCategory(category: string | null | undefined): ThemeId | undefined {
  const text = (category ?? '').trim();
  if (text === '') return undefined;
  const night = THEMES.find((t) => t.id === 'NIGHT');
  if (night?.category.test(text)) return 'NIGHT';
  return THEMES.find((t) => t.id === 'BAR')?.category.test(text) ? 'BAR' : undefined;
}

/** Tema de um evento: tipo “Noite” ou local de balada é Baladas; o resto é Bares (o padrão dos eventos de casa). */
export function themeOfEvent(event: { kind: EventKind; venue: { category: string | null } }): ThemeId {
  if (NIGHT_KINDS.includes(event.kind)) return 'NIGHT';
  return themeOfCategory(event.venue.category) ?? 'BAR';
}

/** Mantém só o que é de algum dos temas. Sem tema escolhido, mantém tudo. */
export function filterByThemes<T>(items: readonly T[], themes: ReadonlySet<ThemeId>, themeOf: (item: T) => ThemeId | undefined): T[] {
  if (themes.size === 0) return [...items];
  return items.filter((item) => {
    const theme = themeOf(item);
    return theme !== undefined && themes.has(theme);
  });
}

const key = (userId: string) => `askout.themes.${userId}`;

export function readThemes(storage: Pick<Storage, 'getItem'> | undefined, userId: string): ThemeId[] {
  try {
    const raw = JSON.parse(storage?.getItem(key(userId)) ?? '[]') as unknown;
    return Array.isArray(raw) ? THEMES.map((t) => t.id).filter((id) => raw.includes(id)) : [];
  } catch {
    return [];
  }
}

export function saveThemes(storage: Pick<Storage, 'setItem'> | undefined, userId: string, themes: readonly ThemeId[]): void {
  try {
    storage?.setItem(key(userId), JSON.stringify(themes));
  } catch {
    // sem armazenamento: só não lembra a escolha
  }
}
