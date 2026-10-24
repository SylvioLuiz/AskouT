import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';

export const ADULT_AGE = 18;
/** Idade mínima para ter conta: o AskouT é só para maiores de 18 anos (decisão de 24/10/2026, também por causa da classificação 18+ da Apple). */
export const MIN_ACCOUNT_AGE = 18;
/** Versão dos Termos de Uso e da Política que o cadastro registra. Mude junto com o texto legal. */
export const TERMS_VERSION = '2026-10-22';
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface AgeStatus {
  /** A pessoa já informou a data de nascimento. */
  declared: boolean;
  /** Tem 18 anos ou mais. Falso também quando ainda não informou. */
  adult: boolean;
  /** A data informada (só para a própria pessoa), ou null. */
  birthDate: string | null;
  /** Conta antiga com data de menor de 18 anos (de antes da regra 18+): não dá para corrigir sozinho, só pelo suporte. */
  locked: boolean;
}

/** Idade completa em `now` para uma data AAAA-MM-DD (usa UTC; o dia do aniversário conta). */
export function ageOn(birthDate: string, now: Date): number {
  const m = DATE_RE.exec(birthDate);
  if (!m) return -1;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = now.getUTCFullYear() - y;
  if (now.getUTCMonth() + 1 < mo || (now.getUTCMonth() + 1 === mo && now.getUTCDate() < d)) age -= 1;
  return age;
}

function isRealDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return dt.getUTCFullYear() === Number(m[1]) && dt.getUTCMonth() === Number(m[2]) - 1 && dt.getUTCDate() === Number(m[3]);
}

/** Confere uma data de nascimento digitada. Devolve a data e a idade, ou lança VALIDATION. */
export function parseBirthDate(raw: unknown, now: Date): { birthDate: string; age: number } {
  if (typeof raw !== 'string' || !isRealDate(raw)) throw validationError('Informe uma data de nascimento válida', { birthDate: 'Informe uma data de nascimento válida' });
  const age = ageOn(raw, now);
  if (age < 0 || age > 120) throw validationError('Informe uma data de nascimento válida', { birthDate: 'Informe uma data de nascimento válida' });
  return { birthDate: raw, age };
}

/** Confere os dados de idade e aceite no cadastro. Lança VALIDATION se faltar o aceite ou a pessoa for pequena demais. */
export function checkSignupConsent(input: { birthDate: unknown; acceptTerms: unknown }, now: Date): { birthDate: string; termsVersion: string } {
  const problems: Record<string, string> = {};
  let birthDate = '';
  try {
    const parsed = parseBirthDate(input.birthDate, now);
    birthDate = parsed.birthDate;
    if (parsed.age < MIN_ACCOUNT_AGE) problems.birthDate = `O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais`;
  } catch (e) {
    problems.birthDate = (e as { details?: Record<string, string> }).details?.birthDate ?? 'Informe uma data de nascimento válida';
  }
  if (input.acceptTerms !== true) problems.acceptTerms = 'Para criar a conta, aceite os Termos de Uso e a Política de Privacidade';
  if (Object.keys(problems).length > 0) throw validationError(Object.values(problems)[0] as string, problems);
  return { birthDate, termsVersion: TERMS_VERSION };
}

export interface TermsStatus {
  currentVersion: string;
  acceptedVersion: string | null;
  acceptedAt: string | null;
  /** false = a pessoa precisa aceitar a versão atual antes de continuar. */
  upToDate: boolean;
}

/**
 * Data de nascimento e idade mínima. O cadastro só aceita 18 anos ou mais. A data é informada uma vez;
 * corrigir erro de digitação só é permitido a quem já consta como maior de idade.
 */
export class AgeService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async status(userId: string): Promise<AgeStatus> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw notFound('Conta não encontrada');
    if (!user.birthDate) return { declared: false, adult: false, birthDate: null, locked: false };
    const adult = ageOn(user.birthDate, this.deps.clock.now()) >= ADULT_AGE;
    return { declared: true, adult, birthDate: user.birthDate, locked: !adult };
  }

  async declare(userId: string, input: { birthDate?: unknown }): Promise<AgeStatus> {
    const { birthDate: raw, age } = parseBirthDate(input.birthDate, this.deps.clock.now());
    const user = await this.deps.users.findById(userId);
    if (!user) throw notFound('Conta não encontrada');
    if (user.birthDate) throw conflict('A data de nascimento já foi informada e não pode ser trocada');
    const saved = await this.deps.users.setBirthDate(userId, raw);
    if (!saved) throw conflict('A data de nascimento já foi informada e não pode ser trocada');
    return { declared: true, adult: age >= ADULT_AGE, birthDate: raw, locked: age < ADULT_AGE };
  }

  /**
   * Corrige a data de nascimento (errei ao digitar). Só quem hoje consta como maior de 18 anos pode;
   * quem consta como menor (conta antiga) fala com o suporte.
   */
  async correct(userId: string, input: { birthDate?: unknown }): Promise<AgeStatus> {
    const now = this.deps.clock.now();
    const { birthDate, age } = parseBirthDate(input.birthDate, now);
    if (age < MIN_ACCOUNT_AGE) throw validationError(`O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais`, { birthDate: `O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais` });
    const current = await this.status(userId);
    if (!current.declared) return this.declare(userId, { birthDate });
    if (current.locked) throw forbidden('Não dá para trocar a data por aqui. Fale com o suporte.');
    await this.deps.users.updateBirthDate(userId, birthDate);
    return { declared: true, adult: age >= ADULT_AGE, birthDate, locked: age < ADULT_AGE };
  }

  /** Qual versão dos Termos a pessoa aceitou e se é a atual. Contas antigas, sem registro, precisam aceitar. */
  async termsStatus(userId: string): Promise<TermsStatus> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw notFound('Conta não encontrada');
    const acceptedVersion = user.termsVersion ?? null;
    return {
      currentVersion: TERMS_VERSION,
      acceptedVersion,
      acceptedAt: acceptedVersion && user.termsAcceptedAt ? new Date(user.termsAcceptedAt).toISOString() : null,
      upToDate: acceptedVersion === TERMS_VERSION,
    };
  }

  /** Aceita os Termos. A versão enviada tem que ser a atual, para ninguém aceitar um texto que não viu. */
  async acceptTerms(userId: string, input: { version?: unknown }): Promise<TermsStatus> {
    if (input.version !== TERMS_VERSION) throw validationError('Os Termos mudaram. Abra a versão atual e aceite de novo.', { version: 'Versão dos Termos desatualizada' });
    const user = await this.deps.users.findById(userId);
    if (!user) throw notFound('Conta não encontrada');
    await this.deps.users.acceptTerms(userId, TERMS_VERSION, this.deps.clock.now());
    return this.termsStatus(userId);
  }
}
