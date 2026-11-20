import { conflict, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import { EVENT_KINDS } from './types.ts';
import type { EventKind } from './types.ts';

/**
 * Gostos de rolê cadastrados pela gestão ("Bares", "Baladas"...). A pessoa escolhe no cadastro e nas configurações, e o
 * app usa as palavras para ligar cada local ao gosto (pelo tipo do local) e os tipos de evento para ligar cada evento.
 * O catálogo fica numa chave do AppSetting (JSON), lido a cada pedido: o que a gestão muda vale na hora. Sem nada
 * gravado, vale `DEFAULT_TASTES` (os gostos que o app já tinha), e a primeira edição grava a lista inteira.
 *
 * Palavras: sem acento nem maiúscula (o app ignora os dois). "bar" casa só a palavra inteira; terminada em `*`
 * ("restaura*") casa qualquer palavra que comece assim ("restaurante"). Várias palavras ("casa noturna") valem juntas.
 */
export const TASTES_SETTING_KEY = 'taste.catalog';
export const TASTES_MAX = 30;
export const TASTE_LABEL_MAX = 40;
export const TASTE_HINT_MAX = 90;
export const TASTE_KEYWORDS_MAX = 40;
export const TASTE_KEYWORD_MAX = 40;

export type TasteOption = {
  id: string;
  label: string;
  hint: string;
  /** Palavras que casam com o tipo do local (texto livre do dono ou tipo do Google/OpenStreetMap). */
  keywords: string[];
  /** Tipos de evento que já são deste gosto, seja qual for o local. */
  kinds: EventKind[];
};

export interface TasteInput {
  label?: unknown;
  hint?: unknown;
  keywords?: unknown;
  kinds?: unknown;
}

/** Os nove gostos que o app já tinha. Os ids ficam: as contas existentes guardam estes ids. */
export const DEFAULT_TASTES: readonly TasteOption[] = [
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

function isTaste(v: unknown): v is TasteOption {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o['id'] === 'string' && typeof o['label'] === 'string' && typeof o['hint'] === 'string' && Array.isArray(o['keywords']) && Array.isArray(o['kinds']);
}

const clone = (t: TasteOption): TasteOption => ({ id: t.id, label: t.label, hint: t.hint, keywords: [...t.keywords], kinds: [...t.kinds] });

/** Lê o catálogo. Nada gravado ou linha estragada vira os gostos de origem (nunca deixa o cadastro sem gostos). */
export async function loadTastes(deps: Pick<CoreDeps, 'settings'>): Promise<TasteOption[]> {
  const row = await deps.settings.get(TASTES_SETTING_KEY);
  if (row) {
    try {
      const parsed: unknown = JSON.parse(row.value);
      if (Array.isArray(parsed)) {
        const items = parsed.filter(isTaste).map((o) => ({
          id: o.id,
          label: o.label,
          hint: o.hint,
          keywords: o.keywords.filter((k): k is string => typeof k === 'string'),
          kinds: o.kinds.filter((k): k is EventKind => (EVENT_KINDS as readonly unknown[]).includes(k)),
        }));
        if (items.length > 0) return items;
      }
    } catch {
      // cai nos gostos de origem
    }
  }
  return DEFAULT_TASTES.map(clone);
}

/** Mantém só gostos do catálogo, sem repetir, na ordem do catálogo. Lança erro de validação se não vier uma lista. */
export function parseTastes(value: unknown, catalog: readonly Pick<TasteOption, 'id'>[]): string[] {
  if (!Array.isArray(value)) throw validationError('Envie a lista de gostos', { tastes: 'Envie a lista de gostos' });
  return catalog.map((t) => t.id).filter((id) => value.includes(id));
}

function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[_\-\s]+/g, ' ').trim();
}

/** Palavras aceitas: separadas por vírgula ou linha, sem acento, sem repetir. */
function parseKeywords(raw: unknown, fields: Record<string, string>): string[] {
  const list = typeof raw === 'string' ? raw.split(/[\n,;]+/) : Array.isArray(raw) ? raw : undefined;
  if (!list) {
    fields['keywords'] = 'Informe ao menos uma palavra do tipo do local';
    return [];
  }
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const stem = item.trim().endsWith('*');
    const word = normalizeText(item.replace(/\*+$/, ''));
    if (word === '') continue;
    if (Array.from(word).length > TASTE_KEYWORD_MAX) {
      fields['keywords'] = `Cada palavra pode ter até ${TASTE_KEYWORD_MAX} caracteres`;
      return [];
    }
    const keyword = stem ? `${word}*` : word;
    if (!out.includes(keyword)) out.push(keyword);
  }
  if (out.length === 0) fields['keywords'] = 'Informe ao menos uma palavra do tipo do local';
  else if (out.length > TASTE_KEYWORDS_MAX) fields['keywords'] = `Use até ${TASTE_KEYWORDS_MAX} palavras`;
  return out;
}

function parseInput(input: TasteInput): Omit<TasteOption, 'id'> {
  const fields: Record<string, string> = {};
  const label = typeof input.label === 'string' ? input.label.trim().replace(/\s+/g, ' ') : '';
  if (label === '') fields['label'] = 'Dê um nome (ex.: Bares)';
  else if (Array.from(label).length > TASTE_LABEL_MAX) fields['label'] = `Use até ${TASTE_LABEL_MAX} caracteres`;
  const hint = typeof input.hint === 'string' ? input.hint.trim().replace(/\s+/g, ' ') : '';
  if (hint === '') fields['hint'] = 'Descreva em poucas palavras (ex.: Boteco, pub, happy hour)';
  else if (Array.from(hint).length > TASTE_HINT_MAX) fields['hint'] = `Use até ${TASTE_HINT_MAX} caracteres`;
  const keywords = parseKeywords(input.keywords, fields);
  let kinds: EventKind[] = [];
  if (input.kinds !== undefined && input.kinds !== null) {
    if (!Array.isArray(input.kinds) || input.kinds.some((k) => !(EVENT_KINDS as readonly unknown[]).includes(k))) fields['kinds'] = 'Tipo de evento inválido';
    else kinds = EVENT_KINDS.filter((k) => (input.kinds as unknown[]).includes(k));
  }
  if (Object.keys(fields).length > 0) throw validationError('Dados inválidos', fields);
  return { label, hint, keywords, kinds };
}

/** Catálogo editado pela gestão. A conferência de papel ADMIN e a auditoria ficam no AdminService. */
export class TastesCatalog {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  list(): Promise<TasteOption[]> {
    return loadTastes(this.deps);
  }

  private async save(items: TasteOption[], adminId: string): Promise<TasteOption[]> {
    await this.deps.settings.set({ key: TASTES_SETTING_KEY, value: JSON.stringify(items), updatedAt: this.deps.clock.now(), updatedBy: adminId });
    return items;
  }

  private static assertUnique(items: readonly TasteOption[], label: string, exceptId?: string): void {
    const key = label.toLocaleLowerCase('pt-BR');
    if (items.some((o) => o.id !== exceptId && o.label.toLocaleLowerCase('pt-BR') === key)) throw conflict('Já existe um gosto com esse nome', { label: 'Já existe um gosto com esse nome' });
  }

  async create(input: TasteInput, adminId: string): Promise<{ taste: TasteOption; items: TasteOption[] }> {
    const parsed = parseInput(input);
    const items = await this.list();
    if (items.length >= TASTES_MAX) throw conflict(`Dá para cadastrar até ${TASTES_MAX} gostos`);
    TastesCatalog.assertUnique(items, parsed.label);
    const taste: TasteOption = { id: this.deps.ids.next(), ...parsed };
    return { taste, items: await this.save([...items, taste], adminId) };
  }

  async update(id: unknown, input: TasteInput, adminId: string): Promise<{ before: TasteOption; taste: TasteOption; items: TasteOption[] }> {
    const parsed = parseInput(input);
    const items = await this.list();
    const before = items.find((o) => o.id === id);
    if (!before) throw notFound('Gosto não encontrado');
    TastesCatalog.assertUnique(items, parsed.label, before.id);
    const taste: TasteOption = { id: before.id, ...parsed };
    return { before, taste, items: await this.save(items.map((o) => (o.id === before.id ? taste : o)), adminId) };
  }

  async remove(id: unknown, adminId: string): Promise<{ taste: TasteOption; items: TasteOption[] }> {
    const items = await this.list();
    const taste = items.find((o) => o.id === id);
    if (!taste) throw notFound('Gosto não encontrado');
    if (items.length === 1) throw conflict('Mantenha ao menos um gosto cadastrado');
    return { taste, items: await this.save(items.filter((o) => o.id !== taste.id), adminId) };
  }

  /** Sobe (`up`) ou desce (`down`) uma posição: é a ordem das telas do app. */
  async move(id: unknown, direction: unknown, adminId: string): Promise<{ taste: TasteOption; items: TasteOption[] }> {
    if (direction !== 'up' && direction !== 'down') throw validationError('Dados inválidos', { direction: 'Use up ou down' });
    const items = await this.list();
    const index = items.findIndex((o) => o.id === id);
    const taste = items[index];
    if (!taste) throw notFound('Gosto não encontrado');
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= items.length) return { taste, items };
    const next = [...items];
    next[index] = next[target] as TasteOption;
    next[target] = taste;
    return { taste, items: await this.save(next, adminId) };
  }
}
