/** Iniciais para o avatar quando a pessoa não tem foto: até duas letras, em maiúsculas. */
export function initials(displayName: string, username: string): string {
  const words = displayName.trim().split(/\s+/).filter((w) => w !== '');
  const source = words.length > 0 ? words : [username];
  const letters = source
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('');
  return letters.toLocaleUpperCase('pt-BR') || '?';
}

export const TINT_COUNT = 6;

/** Cor do avatar sem foto, estável para o mesmo usuário (0 a TINT_COUNT - 1). */
export function tintIndex(username: string): number {
  let hash = 0;
  for (const char of username) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash % TINT_COUNT;
}
