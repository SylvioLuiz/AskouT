/**
 * Regras do botão "Salvar" das telas de detalhe, sem React (testáveis com `node --test`).
 * O botão nunca fica mudo: se não dá para salvar, a tela diz por quê.
 */

export type Problems = Record<string, string | undefined>;

/** Separa os problemas que a API mandou: os de campos que a tela mostra ficam no campo; o resto vira texto no aviso. */
export function splitProblems(fields: Record<string, string> | undefined, shown: readonly string[], alias: Record<string, string> = {}): { byField: Record<string, string>; loose: string[] } {
  const byField: Record<string, string> = {};
  const loose: string[] = [];
  for (const [key, message] of Object.entries(fields ?? {})) {
    const k = alias[key] ?? key;
    if (shown.includes(k)) byField[k] = message;
    else loose.push(message);
  }
  return { byField, loose };
}

/** Por que o "Salvar" não pode seguir agora (`undefined` = pode). `labels` dá o nome de cada campo para o aviso. */
export function saveBlocker(changedCount: number, problems: Problems, labels: Record<string, string> = {}): string | undefined {
  const open = Object.entries(problems).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1] !== '');
  if (open.length > 0) return `Corrija antes de salvar: ${open.map(([k, m]) => (labels[k] ? `${labels[k]}: ${m}` : m)).join(' · ')}`;
  if (changedCount === 0) return 'Nada mudou ainda: altere algum campo antes de salvar.';
  return undefined;
}
