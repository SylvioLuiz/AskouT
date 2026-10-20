export const RECENT_MAX = 8;
const TERM_MAX = 80;

const key = (userId: string) => `askout.recent-searches.${userId}`;

/** Limpa o termo: espaços de sobra saem; menos de 2 letras (ou só “#”) não vale como busca. */
export function cleanTerm(raw: string): string {
  const term = raw.trim().replace(/\s+/g, ' ').slice(0, TERM_MAX);
  if (term.startsWith('#')) return term.replace(/^#+/, '').trim().length >= 1 ? term : '';
  return term.length >= 2 ? term : '';
}

/** Põe o termo no começo; repetido (sem diferenciar maiúsculas) sobe em vez de duplicar; guarda só os mais novos. */
export function addRecent(list: readonly string[], raw: string): string[] {
  const term = cleanTerm(raw);
  if (term === '') return [...list];
  const rest = list.filter((item) => item.toLocaleLowerCase('pt-BR') !== term.toLocaleLowerCase('pt-BR'));
  return [term, ...rest].slice(0, RECENT_MAX);
}

export function removeRecent(list: readonly string[], term: string): string[] {
  return list.filter((item) => item !== term);
}

export function readRecent(storage: Pick<Storage, 'getItem'> | undefined, userId: string): string[] {
  try {
    const raw = JSON.parse(storage?.getItem(key(userId)) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === 'string').map(cleanTerm).filter((x) => x !== '').slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

export function saveRecent(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, userId: string, list: readonly string[]): void {
  try {
    if (list.length === 0) storage?.removeItem(key(userId));
    else storage?.setItem(key(userId), JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    // sem armazenamento: só não lembra as buscas
  }
}

/** Sugestões para o campo vazio: hashtags em alta e nomes de rolês por perto, sem repetir o que já está nas recentes. */
export function buildSuggestions(input: { tags: readonly { tag: string }[]; places: readonly { name: string }[]; recent: readonly string[] }, limit = 8): string[] {
  const seen = new Set(input.recent.map((t) => t.toLocaleLowerCase('pt-BR')));
  const out: string[] = [];
  const add = (term: string) => {
    const cleaned = cleanTerm(term);
    const k = cleaned.toLocaleLowerCase('pt-BR');
    if (cleaned === '' || seen.has(k)) return;
    seen.add(k);
    out.push(cleaned);
  };
  for (const t of input.tags.slice(0, 4)) add(`#${t.tag}`);
  for (const p of input.places.slice(0, 6)) add(p.name);
  return out.slice(0, limit);
}
