import { t } from '../lib/i18n/index.ts';
import type { EventKind } from './types.ts';

/**
 * Os gostos de rolê que a pessoa escolhe no cadastro e edita nas configurações. Para abrir outro, inclua aqui e em
 * TASTE_IDS da API (que valida o que a conta guarda). A ordem daqui é a ordem das telas.
 */
export type ThemeId = 'BAR' | 'NIGHT' | 'SHOW' | 'FOOD' | 'CAFE' | 'CULTURE' | 'GAMES' | 'OUTDOOR' | 'SPORT';

export interface Theme {
  id: ThemeId;
  label: string;
  hint: string;
  /** Casa com o tipo do local (texto livre do dono ou tipo vindo do Google/OpenStreetMap). */
  category: RegExp;
  /** Tipos de evento que já são deste gosto, seja qual for o local. */
  kinds?: readonly EventKind[];
}

export const THEMES: readonly Theme[] = [
  { id: 'BAR', label: t('Bares'), hint: t('Boteco, pub, música ao vivo, happy hour'), category: /\b(bar|pub|boteco|botequim|choperia|cervejaria|biergarten|casa de shows?|samba)\b|bar_|_bar/i },
  { id: 'NIGHT', label: t('Baladas'), hint: t('Balada, festa, pista, noite'), category: /night|balada|boate|danceteria|\bclub\b|club\b|festa|casa noturna/i, kinds: ['NIGHT'] },
  { id: 'SHOW', label: t('Shows'), hint: t('Música ao vivo, samba, pagode, sertanejo, rock'), category: /casa de shows?|\bshows?\b|concert|live_music|music_venue|m[uú]sica ao vivo|samba|pagode|forr[oó]|sertanej|\brock\b|jazz/i, kinds: ['SHOW'] },
  { id: 'FOOD', label: t('Restaurantes'), hint: t('Jantar, pizza, hambúrguer, japonês, rodízio'), category: /restaura|pizza|hamburg|burger|churrasc|steak|sushi|japon|lanchonete|bistr[oô]|cantina|rod[ií]zio|gastrono|comida|\bfood\b|fast_food|_restaurant|restaurant_/i, kinds: ['GASTRONOMY'] },
  { id: 'CAFE', label: t('Cafés e docerias'), hint: t('Café, padaria, brunch, sorvete'), category: /\bcaf[eé]s?\b|cafeteria|coffee|padaria|bakery|confeitaria|doceria|sorvet|ice_cream|brunch|tea_house|_cafe|cafe_/i },
  { id: 'CULTURE', label: t('Cinema e cultura'), hint: t('Cinema, teatro, museu, exposição, stand-up'), category: /cinema|movie|teatro|theat(er|re)|museu|museum|galeria|gallery|arts_centre|centro cultural|exposi|stand.?up|com[eé]dia|performing_arts/i, kinds: ['CINEMA', 'THEATER', 'EXHIBITION'] },
  { id: 'GAMES', label: t('Karaokê e jogos'), hint: t('Karaokê, sinuca, boliche, fliperama, escape room'), category: /karaok|sinuca|bilhar|snooker|boliche|bowling|fliperama|arcade|escape|jogos|games?\b|amusement_center/i },
  { id: 'OUTDOOR', label: t('Ao ar livre'), hint: t('Parque, praia, trilha, feira, piquenique'), category: /\bpark\b|_park|park_|parque|praia|beach|pra[çc]a|jardim|garden|trilha|hiking|mirante|viewpoint|camping|feira/i, kinds: ['OUTDOOR'] },
  { id: 'SPORT', label: t('Esportes'), hint: t('Jogo no estádio, futebol, beach tennis, corrida'), category: /stadium|est[aá]dio|arena|gin[aá]sio|esporte|sports?\b|futebol|soccer|quadra|beach tennis|t[eê]nis|padel|golf|surf|skate|corrida/i, kinds: ['SPORT'] },
];

const ALL_IDS: readonly ThemeId[] = THEMES.map((theme) => theme.id);

export function themeLabel(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.label ?? '';
}

/** Todos os gostos de um local pelo tipo (um “bar com música ao vivo” é Bares e Shows), na ordem de THEMES. */
export function themesOfCategory(category: string | null | undefined): ThemeId[] {
  const text = (category ?? '').trim();
  if (text === '') return [];
  return THEMES.filter((theme) => theme.category.test(text)).map((theme) => theme.id);
}

/** Gosto principal de um local pelo tipo. Balada ganha de bar (“bar e balada” é balada). */
export function themeOfCategory(category: string | null | undefined): ThemeId | undefined {
  const all = themesOfCategory(category);
  return all.includes('NIGHT') ? 'NIGHT' : all[0];
}

/**
 * Todos os gostos de um evento: o do tipo do evento e os do local. Sem nenhum, é Bares (o padrão dos eventos de casa).
 * O primeiro é o principal: tipo “Noite” ou local de balada vem antes.
 */
export function themesOfEvent(event: { kind: EventKind; venue: { category: string | null } }): ThemeId[] {
  const byKind = THEMES.filter((theme) => theme.kinds?.includes(event.kind)).map((theme) => theme.id);
  const byPlace = themesOfCategory(event.venue.category);
  const all = [...new Set([...byKind, ...byPlace])];
  if (all.length === 0) return ['BAR'];
  return all.includes('NIGHT') ? ['NIGHT', ...all.filter((id) => id !== 'NIGHT')] : all;
}

/** Gosto principal de um evento. */
export function themeOfEvent(event: { kind: EventKind; venue: { category: string | null } }): ThemeId {
  return themesOfEvent(event)[0] ?? 'BAR';
}

/** Mantém só ids conhecidos, sem repetir, na ordem de THEMES. */
export function cleanThemes(value: unknown): ThemeId[] {
  return Array.isArray(value) ? ALL_IDS.filter((id) => value.includes(id)) : [];
}

/**
 * Gostos da pessoa: os da conta (valem em qualquer aparelho) e, se a conta ainda não tem, os que este navegador guardou
 * antes de os gostos irem para a conta.
 */
export function userThemes(storage: Pick<Storage, 'getItem'> | undefined, user: { id: string; tastes?: readonly string[] }): ThemeId[] {
  const fromAccount = cleanThemes(user.tastes);
  return fromAccount.length > 0 ? fromAccount : readThemes(storage, user.id);
}

/** Filtro de tela a partir dos gostos: quem marcou tudo (ou nada) vê tudo. */
export function themeFilter(themes: readonly ThemeId[]): Set<ThemeId> {
  return themes.length === THEMES.length ? new Set() : new Set(themes);
}

/** Mantém só o que é de algum dos temas. Sem tema escolhido, mantém tudo. */
export function filterByThemes<T>(items: readonly T[], themes: ReadonlySet<ThemeId>, themeOf: (item: T) => ThemeId | readonly ThemeId[] | undefined): T[] {
  if (themes.size === 0) return [...items];
  return items.filter((item) => {
    const of = themeOf(item);
    const list: readonly ThemeId[] = of === undefined ? [] : typeof of === 'string' ? [of] : of;
    return list.some((theme) => themes.has(theme));
  });
}

const key = (userId: string) => `askout.themes.${userId}`;

export function readThemes(storage: Pick<Storage, 'getItem'> | undefined, userId: string): ThemeId[] {
  try {
    const raw = JSON.parse(storage?.getItem(key(userId)) ?? '[]') as unknown;
    return cleanThemes(raw);
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
