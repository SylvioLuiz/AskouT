/** Idade completa em `now` para uma data AAAA-MM-DD; -1 se a data não existir. */
export function ageOnDate(birth: string, now: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
  if (!m) return -1;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return -1;
  const month = now.getMonth() + 1;
  let age = now.getFullYear() - y;
  if (month < mo || (month === mo && now.getDate() < d)) age -= 1;
  return age;
}

/** Hoje (no relógio do aparelho) como AAAA-MM-DD, para limitar o campo de data. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Mensagem de erro para a data digitada, ou undefined se estiver ok. Não decide se é maior de idade: quem decide é a API. */
export function birthDateProblem(birth: string, now: Date): string | undefined {
  if (birth === '') return 'Informe a sua data de nascimento';
  const age = ageOnDate(birth, now);
  if (age < 0 || age > 120) return 'Informe uma data válida';
  return undefined;
}

/** Idade mínima para ter conta (a API confere de novo; este número só avisa mais cedo). */
export const MIN_ACCOUNT_AGE = 13;

/** Problemas na data de nascimento e no aceite dos Termos, por campo. Vazio = pode enviar. */
export function consentProblems(birth: string, accepted: boolean, now: Date): Record<string, string> {
  const out: Record<string, string> = {};
  const problem = birthDateProblem(birth, now);
  if (problem) out['birthDate'] = problem;
  else if (ageOnDate(birth, now) < MIN_ACCOUNT_AGE) out['birthDate'] = `O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais`;
  if (!accepted) out['acceptTerms'] = 'Para criar a conta, aceite os Termos de Uso e a Política de Privacidade';
  return out;
}
