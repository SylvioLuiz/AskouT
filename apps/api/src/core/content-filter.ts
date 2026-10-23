/**
 * Filtro simples de texto ofensivo para @usuário, nome e biografia.
 *
 * É uma barreira mínima, não moderação: pega só termos inequívocos (ódio, apologia a crime, xingamentos pesados).
 * O resto continua por denúncia e moderação manual. Lista curta de propósito: cada termo a mais aumenta o risco
 * de barrar nome de gente de verdade (ex.: "computador" contém "puta").
 *  - EMBUTIDOS: valem mesmo no meio de outra palavra (necessário em @usuário, que não tem espaços). Só termos longos e raros.
 *  - PALAVRAS: valem só como palavra inteira (nome e biografia).
 */

const EMBEDDED = ['nazi', 'hitler', 'estupr', 'pedofil', 'nigger', 'nigga', 'cuzao', 'arrombad'];
const WORDS = ['puta', 'putaria', 'caralho', 'fdp', 'vsf', 'viadinho', 'macaco', 'retardado', 'retardada', 'mongoloide', 'vagabunda'];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

/** Minúsculas, sem acentos, sem "leetspeak" (p0rr@ → porra) e com letras repetidas reduzidas (puuuta → puta). */
export function foldText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[0-9@$]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1');
}

/** true se o texto tem termo ofensivo. `wordsToo` liga também a lista de palavras inteiras (nome e biografia). */
export function hasOffensiveText(raw: string, wordsToo: boolean): boolean {
  const folded = foldText(raw);
  // sem separadores, para pegar "n.a.z.i" e "estu_pro" em @usuário
  const squashed = folded.replace(/[^a-z]/g, '');
  if (EMBEDDED.some((term) => squashed.includes(term))) return true;
  if (!wordsToo) return false;
  const tokens = folded.split(/[^a-z]+/).filter(Boolean);
  const collapsed = tokens.map((t) => t.replace(/(.)\1+/g, '$1'));
  const targets = WORDS.map((w) => w.replace(/(.)\1+/g, '$1'));
  return collapsed.some((t) => targets.includes(t));
}

export const OFFENSIVE_MESSAGE = 'Este texto contém termos que não são permitidos no AskouT';
