// Regras de formulário que espelham as da API (apps/api/src/core/validation.ts). Servem para avisar cedo;
// quem decide é sempre o servidor, e as mensagens dele aparecem junto do campo certo.

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function emailProblem(email: string): string | undefined {
  const value = email.trim();
  if (value === '') return 'Informe seu e-mail';
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Esse e-mail não parece válido';
  return undefined;
}

export function usernameProblem(username: string): string | undefined {
  if (username.length < 3) return 'Use ao menos 3 caracteres';
  if (username.length > 30) return 'Use no máximo 30 caracteres';
  if (!/^[a-z0-9._]+$/.test(username)) return 'Use só letras minúsculas, números, ponto e sublinhado';
  if (username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    return 'O ponto não pode ficar no início, no fim nem aparecer duas vezes seguidas';
  }
  return undefined;
}

export function passwordProblem(password: string): string | undefined {
  if (password.length < 8) return 'Use ao menos 8 caracteres';
  if (password.length > 128) return 'Use no máximo 128 caracteres';
  return undefined;
}

export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 150;

export function displayNameProblem(name: string, required: boolean): string | undefined {
  const value = name.trim();
  if (value === '') return required ? 'Informe seu nome' : undefined;
  if (Array.from(value).length > DISPLAY_NAME_MAX) return `Use no máximo ${DISPLAY_NAME_MAX} caracteres`;
  return undefined;
}

export function bioProblem(bio: string): string | undefined {
  if (Array.from(bio.trim()).length > BIO_MAX) return `Use no máximo ${BIO_MAX} caracteres`;
  return undefined;
}

export function avatarUrlProblem(url: string): string | undefined {
  const value = url.trim();
  if (value === '') return undefined;
  if (value.length > 2048) return 'O endereço é longo demais';
  try {
    if (new URL(value).protocol !== 'https:') return 'Use um endereço que comece com https://';
  } catch {
    return 'Esse endereço não parece válido';
  }
  return undefined;
}

export function codeProblem(code: string): string | undefined {
  return /^\d{6}$/.test(code.trim()) ? undefined : 'O código tem 6 números';
}

export function loginIdentifierProblem(value: string): string | undefined {
  return value.trim() === '' ? 'Informe seu e-mail ou @usuário' : undefined;
}

/** Remove entradas sem mensagem para que `Object.keys(errors).length === 0` signifique "sem erros". */
export function compact(errors: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
