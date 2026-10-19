/** Quantas pessoas um comentário pode mencionar (as demais ficam como texto). */
export const MENTIONS_MAX = 10;

/**
 * Nomes de usuário marcados com @ no texto, em minúsculas e sem repetir.
 * Vale o mesmo formato do cadastro (3 a 30 letras, números, ponto e sublinhado); "@" colado numa palavra (e-mail) não conta.
 */
export function extractMentions(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/(?<![\w.@])@([a-z0-9._]{3,30})/gi)) {
    const name = (match[1] ?? '').toLowerCase().replace(/\.+$/, '');
    if (name.length >= 3 && !found.includes(name)) found.push(name);
    if (found.length >= MENTIONS_MAX) break;
  }
  return found;
}
