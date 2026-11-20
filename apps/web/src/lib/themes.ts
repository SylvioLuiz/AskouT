import { t } from '../lib/i18n/index.ts';
import type { EventKind } from './types.ts';

/**
 * Os gostos de rolê que a pessoa escolhe no cadastro e edita nas configurações. A lista vem da API (a gestão cadastra em
 * "Gostos"); `DEFAULT_DEFINITIONS` é a de origem: vale até a API responder e se ela não responder. A ordem é a das telas.
 * `THEMES` é uma lista viva (trocada no lugar por `setThemes`); telas que a desenham usam `useThemes()`.
 */
export type ThemeId = string;

export interface Theme {
  id: ThemeId;
  label: string;
  hint: string;
  /** Casa com o tipo do local já passado por `normalizeCategory` (texto livre do dono ou tipo do Google/OpenStreetMap). */
  category: RegExp;
  /** Tipos de evento que já são deste gosto, seja qual for o local. */
  kinds?: readonly EventKind[];
}

/** Gosto como a API entrega: palavras no lugar de expressão regular. */
export interface TasteDefinition {
  id: string;
  label: string;
  hint: string;
  keywords: readonly string[];
  kinds: readonly string[];
}

/** Texto sem acento, minúsculo, com `_` e `-` como espaço (tipos do Google vêm como "night_club"). */
export function normalizeCategory(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[_\-\s]+/g, ' ').trim();
}

/**
 * Palavras do gosto viram uma expressão: "bar" casa só a palavra inteira; "restaura*" casa o começo de uma palavra.
 * Use com o texto já passado por `normalizeCategory`.
 */
export function keywordsRegExp(keywords: readonly string[]): RegExp {
  const parts = keywords.flatMap((raw) => {
    const stem = raw.trim().endsWith('*');
    const word = normalizeCategory(raw.replace(/\*+$/, ''));
    if (word === '') return [];
    const body = word.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(' ');
    return [`(?<![a-z0-9])${body}${stem ? '' : '(?![a-z0-9])'}`];
  });
  return parts.length === 0 ? /$^/ : new RegExp(parts.join('|'));
}

function build(def: TasteDefinition): Theme {
  return { id: def.id, label: t(def.label), hint: t(def.hint), category: keywordsRegExp(def.keywords), kinds: def.kinds as readonly EventKind[] };
}

/** Os nove gostos de origem (os mesmos de DEFAULT_TASTES na API). Os textos passam pelo t() para a tradução achar. */
const DEFAULT_DEFINITIONS: readonly TasteDefinition[] = [
  { id: 'BAR', label: 'Bares', hint: 'Boteco, pub, música ao vivo, happy hour', keywords: ['bar', 'pub', 'boteco', 'botequim', 'choperia', 'cervejaria', 'biergarten', 'casa de show', 'casa de shows', 'samba'], kinds: [] },
  { id: 'NIGHT', label: 'Baladas', hint: 'Balada, festa, pista, noite', keywords: ['night*', 'balada*', 'boate*', 'danceteria', 'club', 'festa*', 'casa noturna'], kinds: ['NIGHT'] },
  { id: 'SHOW', label: 'Shows', hint: 'Música ao vivo, samba, pagode, sertanejo, rock', keywords: ['casa de show', 'casa de shows', 'show', 'shows', 'concert*', 'live music', 'music venue', 'musica ao vivo', 'samba', 'pagode', 'forro', 'sertanej*', 'rock', 'jazz'], kinds: ['SHOW'] },
  { id: 'FOOD', label: 'Restaurantes', hint: 'Jantar, pizza, hambúrguer, japonês, rodízio', keywords: ['restaura*', 'pizza*', 'hamburg*', 'burger*', 'churrasc*', 'steak*', 'sushi*', 'japon*', 'lanchonete*', 'bistro*', 'cantina*', 'rodizio*', 'gastrono*', 'comida*', 'food'], kinds: ['GASTRONOMY'] },
  { id: 'CAFE', label: 'Cafés e docerias', hint: 'Café, padaria, brunch, sorvete', keywords: ['cafe', 'cafes', 'cafeteria*', 'coffee*', 'padaria*', 'bakery*', 'confeitaria*', 'doceria*', 'sorvet*', 'ice cream', 'brunch*', 'tea house'], kinds: [] },
  { id: 'CULTURE', label: 'Cinema e cultura', hint: 'Cinema, teatro, museu, exposição, stand-up', keywords: ['cinema*', 'movie*', 'teatro*', 'theater', 'theatre', 'museu*', 'museum*', 'galeria*', 'gallery', 'arts centre', 'centro cultural', 'exposi*', 'stand up', 'standup', 'comedia*', 'performing arts'], kinds: ['CINEMA', 'THEATER', 'EXHIBITION'] },
  { id: 'GAMES', label: 'Karaokê e jogos', hint: 'Karaokê, sinuca, boliche, fliperama, escape room', keywords: ['karaok*', 'sinuca*', 'bilhar*', 'snooker*', 'boliche*', 'bowling*', 'fliperama*', 'arcade*', 'escape*', 'jogos', 'game', 'games', 'amusement center'], kinds: [] },
  { id: 'OUTDOOR', label: 'Ao ar livre', hint: 'Parque, praia, trilha, feira, piquenique', keywords: ['park', 'parque*', 'praia*', 'beach*', 'praca*', 'jardim*', 'garden*', 'trilha*', 'hiking', 'mirante*', 'viewpoint', 'camping*', 'feira*'], kinds: ['OUTDOOR'] },
  { id: 'SPORT', label: 'Esportes', hint: 'Jogo no estádio, futebol, beach tennis, corrida', keywords: ['stadium*', 'estadio*', 'arena*', 'ginasio*', 'esporte*', 'sport', 'sports', 'futebol*', 'soccer*', 'quadra*', 'beach tennis', 'tenis*', 'padel*', 'golf*', 'surf*', 'skate*', 'corrida*'], kinds: ['SPORT'] },
];

/** A lista viva. Quem só lê pode importar; quem desenha a lista usa `useThemes()` para redesenhar quando ela chegar. */
export const THEMES: Theme[] = DEFAULT_DEFINITIONS.map(build);

type Listener = () => void;
const listeners = new Set<Listener>();
let version = 0;

/** Troca a lista (resposta da API). Lista vazia é ignorada: o app nunca fica sem gostos. */
export function setThemes(definitions: readonly TasteDefinition[]): void {
  if (definitions.length === 0) return;
  THEMES.splice(0, THEMES.length, ...definitions.map(build));
  version += 1;
  for (const listener of listeners) listener();
}

export function subscribeThemes(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const themesVersion = (): number => version;

export function themeLabel(id: ThemeId): string {
  return THEMES.find((x) => x.id === id)?.label ?? '';
}

/** Todos os gostos de um local pelo tipo (um “bar com música ao vivo” é Bares e Shows), na ordem de THEMES. */
export function themesOfCategory(category: string | null | undefined): ThemeId[] {
  const text = normalizeCategory(category ?? '');
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
  if (all.length === 0) return THEMES.some((theme) => theme.id === 'BAR') ? ['BAR'] : [];
  return all.includes('NIGHT') ? ['NIGHT', ...all.filter((id) => id !== 'NIGHT')] : all;
}

/** Gosto principal de um evento. */
export function themeOfEvent(event: { kind: EventKind; venue: { category: string | null } }): ThemeId {
  return themesOfEvent(event)[0] ?? 'BAR';
}

/** Mantém só ids conhecidos, sem repetir, na ordem de THEMES. */
export function cleanThemes(value: unknown): ThemeId[] {
  return Array.isArray(value) ? THEMES.map((theme) => theme.id).filter((id) => value.includes(id)) : [];
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
