/**
 * Iniciais para o avatar quando a pessoa não tem foto: vêm do @usuário, nunca do nome real.
 * "bruna.alves" vira "BA"; "bruno" vira "BR".
 */
export function initials(username: string): string {
  const parts = username.split(/[^\p{L}\p{N}]+/u).filter((p) => p !== '');
  const letters = parts.length >= 2 ? parts.slice(0, 2).map((p) => Array.from(p)[0] ?? '').join('') : Array.from(parts[0] ?? '').slice(0, 2).join('');
  return letters.toLocaleUpperCase('pt-BR') || '?';
}

export const TINT_COUNT = 6;

/** Cor do avatar sem foto, estável para o mesmo usuário (0 a TINT_COUNT - 1). */
export function tintIndex(username: string): number {
  let hash = 0;
  for (const char of username) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
  return hash % TINT_COUNT;
}
