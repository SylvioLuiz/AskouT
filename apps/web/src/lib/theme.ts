import { t } from '../lib/i18n/index.ts';
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_KEY = 'askout:theme';
export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: t('Automático (igual ao aparelho)'),
  light: 'Claro',
  dark: 'Escuro',
};

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Valor guardado, ou "system". Nunca lança: o armazenamento pode estar bloqueado. */
export function readTheme(storage: Pick<Storage, 'getItem'> | undefined): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_KEY);
    return isThemeChoice(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** Marca o tema na página: "system" tira o atributo e deixa valer a preferência do aparelho. */
export function applyTheme(choice: ThemeChoice, root: { setAttribute(name: string, value: string): void; removeAttribute(name: string): void }): void {
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
}

export function saveTheme(choice: ThemeChoice, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined): void {
  try {
    if (choice === 'system') storage?.removeItem(THEME_KEY);
    else storage?.setItem(THEME_KEY, choice);
  } catch {
    // sem armazenamento: o tema vale só até fechar a página
  }
}
