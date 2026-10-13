import { validationError } from './errors.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9._]{3,30}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'askout',
  'suporte',
  'support',
  'root',
  'api',
  'help',
  'ajuda',
  'moderator',
  'moderacao',
  'system',
  'null',
  'undefined',
]);

const COMMON_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '11111111',
  'password',
  'password1',
  'senha123',
  'senha1234',
  'qwerty123',
  'abc12345',
  'iloveyou',
]);

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;
export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 150;

/** Entradas vindas de HTTP podem não ser string; qualquer outro tipo vira ''. */
export function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/** Retorna o motivo do erro, ou undefined se válido. */
export function emailProblem(email: string): string | undefined {
  if (email.length > 254) return 'E-mail muito longo';
  if (!EMAIL_RE.test(email)) return 'E-mail inválido';
  return undefined;
}

export function usernameProblem(username: string): string | undefined {
  if (!USERNAME_RE.test(username)) {
    return 'Use de 3 a 30 caracteres: letras minúsculas, números, ponto e sublinhado';
  }
  if (username.startsWith('.') || username.endsWith('.')) return 'Não pode começar nem terminar com ponto';
  if (username.includes('..')) return 'Não pode ter dois pontos seguidos';
  if (RESERVED_USERNAMES.has(username)) return 'Este nome de usuário não está disponível';
  return undefined;
}

export function passwordProblem(password: string, email: string, username: string): string | undefined {
  if (password.length < PASSWORD_MIN) return `A senha precisa ter ao menos ${PASSWORD_MIN} caracteres`;
  if (password.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres`;
  if (password.trim().length === 0) return 'A senha não pode ser só espaços';
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'Senha muito comum';
  if (lower === email || lower === username) return 'A senha não pode ser igual ao e-mail ou ao nome de usuário';
  return undefined;
}

export function displayNameProblem(name: string): string | undefined {
  if (name.length === 0) return 'Informe um nome';
  if (name.length > DISPLAY_NAME_MAX) return `O nome pode ter no máximo ${DISPLAY_NAME_MAX} caracteres`;
  if (CONTROL_CHARS_RE.test(name)) return 'O nome tem caracteres inválidos';
  return undefined;
}

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/** '' vira null. */
export function normalizeBio(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function bioProblem(bio: string | null): string | undefined {
  if (bio === null) return undefined;
  if (bio.length > BIO_MAX) return `A biografia pode ter no máximo ${BIO_MAX} caracteres`;
  // quebras de linha são permitidas; demais controles não
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(bio)) return 'A biografia tem caracteres inválidos';
  return undefined;
}

export function avatarUrlProblem(url: string | null): string | undefined {
  if (url === null) return undefined;
  if (url.length > 2048) return 'URL da foto muito longa';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return 'A URL da foto precisa usar https';
  } catch {
    return 'URL da foto inválida';
  }
  return undefined;
}

/** Lança VALIDATION uma única vez, reunindo todos os campos com problema. */
export function assertNoProblems(problems: Record<string, string | undefined>): void {
  const details: Record<string, string> = {};
  for (const [field, problem] of Object.entries(problems)) {
    if (problem) details[field] = problem;
  }
  if (Object.keys(details).length > 0) {
    throw validationError('Dados inválidos', details);
  }
}
