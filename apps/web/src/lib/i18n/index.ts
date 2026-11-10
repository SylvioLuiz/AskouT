/**
 * Idiomas do app. O texto original (português do Brasil) é a própria chave: `t('Entrar')`.
 * Se faltar tradução, aparece o português (nunca uma chave quebrada).
 * O idioma é lido uma vez ao abrir o app; trocar na tela de ajustes recarrega a página.
 */
export type Locale = 'pt-BR' | 'en' | 'es';

export const LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'pt-BR', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

const STORAGE_KEY = 'askout.locale';
// Os dicionários en/es pesam ~360 kB; só o do idioma em uso é baixado (ver loadLocale, chamada antes de abrir o app).
const DICTIONARIES: Record<Locale, Readonly<Record<string, string>>> = { 'pt-BR': {}, en: {}, es: {} };

/** Baixa o dicionário do idioma atual (pt-BR não precisa). Chame e espere antes de desenhar a primeira tela. */
export async function loadLocale(): Promise<void> {
  try {
    if (current === 'en') DICTIONARIES.en = (await import('./en.ts')).EN;
    else if (current === 'es') DICTIONARIES.es = (await import('./es.ts')).ES;
  } catch {
    /* sem o dicionário, aparece o português */
  }
}

/** Só para testes. */
export function registerDictionaryForTests(locale: Locale, dictionary: Readonly<Record<string, string>>): void {
  DICTIONARIES[locale] = dictionary;
}

/** Escolha do idioma a partir de um código do aparelho (`en-US`, `es-MX`, `pt-PT`...). */
export function pickLocale(code: string | undefined): Locale {
  const lang = (code ?? '').toLowerCase();
  if (lang.startsWith('en')) return 'en';
  if (lang.startsWith('es')) return 'es';
  return 'pt-BR';
}

function readStored(): Locale | undefined {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return LOCALES.some((l) => l.code === value) ? (value as Locale) : undefined;
  } catch {
    return undefined;
  }
}

function detect(): Locale {
  if (typeof window === 'undefined') return 'pt-BR';
  return readStored() ?? pickLocale(window.navigator.languages?.[0] ?? window.navigator.language);
}

let current: Locale = detect();

export function getLocale(): Locale {
  return current;
}

/** Só para testes. */
export function setLocaleForTests(locale: Locale): void {
  current = locale;
}

/** Guarda a escolha da pessoa e recarrega para o app inteiro usar o novo idioma. */
export function chooseLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* sem armazenamento: vale só até recarregar */
  }
  current = locale;
  window.location.reload();
}

/** Texto para datas e números (`Intl`). */
export function intlLocale(): string {
  return current === 'pt-BR' ? 'pt-BR' : current === 'en' ? 'en-US' : 'es-ES';
}

/** Traduz. Variáveis entram como `{nome}`: `t('Olá, {nome}', { nome })`. */
export function t(text: string, vars?: Readonly<Record<string, string | number>>): string {
  const translated = DICTIONARIES[current][text] ?? text;
  if (!vars) return translated;
  return translated.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole));
}

/** Troca o ponto decimal de um número já formatado com ponto ("1.2") pela convenção do idioma ("1,2" em pt/es). */
export function decimal(text: string): string {
  return current === 'en' ? text : text.replace('.', ',');
}
