import type { ReturnRate } from './types.ts';

export const pct = (v: number | null, digits = 1): string => (v === null ? '—' : `${(v * 100).toFixed(digits).replace('.', ',')}%`);

/** 4200 -> "4,2 s"; 75000 -> "1 min 15 s". */
export function seconds(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
  const m = Math.floor(ms / 60_000);
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** Diferença em pontos percentuais entre duas taxas, ou null se faltar uma. */
export function pointsDiff(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : (a - b) * 100;
}

/** Amostra pequena demais para tirar conclusão. */
export const isThin = (r: Pick<ReturnRate, 'sample'>, min: number): boolean => r.sample < min;

/** Frase honesta sobre quem viu o bloco contra quem não viu. Nunca afirma causa. */
export function returnVerdict(withReco: ReturnRate, withoutReco: ReturnRate, min: number): string {
  if (isThin(withReco, min) || isThin(withoutReco, min)) return `Poucos dados (menos de ${min} dias de uso em algum dos grupos). Espere juntar mais antes de comparar.`;
  const d = pointsDiff(withReco.rate, withoutReco.rate);
  if (d === null) return 'Sem dados.';
  const abs = Math.abs(d).toFixed(1).replace('.', ',');
  if (Math.abs(d) < 2) return `Quem viu o bloco voltou quase igual a quem não viu (diferença de ${abs} ponto percentual).`;
  return `Quem viu o bloco voltou ${abs} pontos percentuais ${d > 0 ? 'mais' : 'menos'} que quem não viu. Isso não prova causa: quem usa mais o app também vê mais o bloco.`;
}
