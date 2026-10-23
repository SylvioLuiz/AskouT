import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';

export const ADULT_AGE = 18;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface AgeStatus {
  /** A pessoa já informou a data de nascimento. */
  declared: boolean;
  /** Tem 18 anos ou mais. Falso também quando ainda não informou. */
  adult: boolean;
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

/**
 * Trava de idade do Flash. A data de nascimento é informada uma vez e não muda depois:
 * assim, quem põe uma data de menor de idade não consegue "tentar de novo" com outra.
 */
export class AgeService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async status(userId: string): Promise<AgeStatus> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw notFound('Conta não encontrada');
    if (!user.birthDate) return { declared: false, adult: false };
    return { declared: true, adult: ageOn(user.birthDate, this.deps.clock.now()) >= ADULT_AGE };
  }

  async declare(userId: string, input: { birthDate?: unknown }): Promise<AgeStatus> {
    const raw = input.birthDate;
    const now = this.deps.clock.now();
    if (typeof raw !== 'string' || !isRealDate(raw)) throw validationError('Informe uma data válida', { birthDate: 'Informe uma data válida' });
    const age = ageOn(raw, now);
    if (age < 0 || age > 120) throw validationError('Informe uma data válida', { birthDate: 'Informe uma data válida' });
    const user = await this.deps.users.findById(userId);
    if (!user) throw notFound('Conta não encontrada');
    if (user.birthDate) throw conflict('A data de nascimento já foi informada e não pode ser trocada');
    const saved = await this.deps.users.setBirthDate(userId, raw);
    if (!saved) throw conflict('A data de nascimento já foi informada e não pode ser trocada');
    return { declared: true, adult: age >= ADULT_AGE };
  }

  /** Usado pelo Flash: recusa quem não informou a data ou tem menos de 18 anos. */
  async requireAdult(userId: string): Promise<void> {
    const s = await this.status(userId);
    if (!s.declared) throw forbidden('Informe sua data de nascimento para usar o Flash');
    if (!s.adult) throw forbidden('O Flash é só para maiores de 18 anos');
  }
}
