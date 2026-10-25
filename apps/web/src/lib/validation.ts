import { t } from '../lib/i18n/index.ts';
// Regras de formulário que espelham as da API (apps/api/src/core/validation.ts). Servem para avisar cedo;
// quem decide é sempre o servidor, e as mensagens dele aparecem junto do campo certo.

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

export function emailProblem(email: string): string | undefined {
  const value = email.trim();
  if (value === '') return t('Informe seu e-mail');
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return t('Esse e-mail não parece válido');
  return undefined;
}

export function usernameProblem(username: string): string | undefined {
  if (username.length < 3) return t('Use ao menos 3 caracteres');
  if (username.length > 30) return t('Use no máximo 30 caracteres');
  if (!/^[a-z0-9._]+$/.test(username)) return t('Use só letras minúsculas, números, ponto e sublinhado');
  if (username.startsWith('.') || username.endsWith('.') || username.includes('..')) {
    return t('O ponto não pode ficar no início, no fim nem aparecer duas vezes seguidas');
  }
  return undefined;
}

export function passwordProblem(password: string): string | undefined {
  if (password.length < 8) return t('Use ao menos 8 caracteres');
  if (password.length > 128) return t('Use no máximo 128 caracteres');
  return undefined;
}

export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 150;

export function displayNameProblem(name: string, required: boolean): string | undefined {
  const value = name.trim();
  if (value === '') return required ? t('Informe seu nome') : undefined;
  if (Array.from(value).length > DISPLAY_NAME_MAX) return t('Use no máximo {DISPLAY_NAME_MAX} caracteres', { DISPLAY_NAME_MAX });
  return undefined;
}

export function bioProblem(bio: string): string | undefined {
  if (Array.from(bio.trim()).length > BIO_MAX) return t('Use no máximo {BIO_MAX} caracteres', { BIO_MAX });
  return undefined;
}

export function avatarUrlProblem(url: string): string | undefined {
  const value = url.trim();
  if (value === '') return undefined;
  if (value.length > 2048) return t('O endereço é longo demais');
  try {
    if (new URL(value).protocol !== 'https:') return t('Use um endereço que comece com https://');
  } catch {
    return t('Esse endereço não parece válido');
  }
  return undefined;
}

export function codeProblem(code: string): string | undefined {
  return /^\d{6}$/.test(code.trim()) ? undefined : t('O código tem 6 números');
}

export function loginIdentifierProblem(value: string): string | undefined {
  return value.trim() === '' ? t('Informe seu e-mail ou @usuário') : undefined;
}

/** Remove entradas sem mensagem para que `Object.keys(errors).length === 0` signifique "sem erros". */
export function compact(errors: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(errors)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
