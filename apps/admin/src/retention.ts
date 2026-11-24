import type { ProportionDiff, ReturnRate } from './types.ts';

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

/** Frase da diferença tratamento − controle, em pontos percentuais, com o intervalo de 95%. Só afirma efeito com amostra suficiente. */
export function experimentVerdict(d: ProportionDiff | null, thin: boolean, min: number): string {
  if (d === null) return 'Sem dados nos dois grupos ainda.';
  const p = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(1).replace('.', ',')}`;
  const range = `${p(d.diff)} pontos percentuais (intervalo de 95%: ${p(d.low)} a ${p(d.high)})`;
  if (thin) return `Poucos dados (menos de ${min} pessoas em algum grupo): ${range}. Ainda é palpite.`;
  if (!d.significant) return `Diferença de ${range}. O intervalo inclui zero: não dá para dizer que o bloco muda o retorno.`;
  return `Diferença de ${range}. O intervalo não inclui zero: com quem foi sorteado, ver o bloco ${d.diff > 0 ? 'aumentou' : 'diminuiu'} o retorno.`;
}

export type RetentionKind = 'd1' | 'd7';
export type RetentionTone = 'ok' | 'warn' | 'bad' | 'neutral';

/**
 * Faixas de retorno, a partir das referências usuais de apps sociais (D1 de 25% a 40%,
 * D7 de 10% a 20%). Acima do topo é bom, entre as duas é atenção, abaixo do piso é ruim.
 */
export const RETENTION_BANDS: Record<RetentionKind, { good: number; attention: number; label: string }> = {
  d1: { good: 0.4, attention: 0.25, label: 'Voltou no dia seguinte (D1)' },
  d7: { good: 0.2, attention: 0.1, label: 'Voltou 7 dias depois (D7)' },
};

/** Cor da taxa de retorno. Sem taxa ou com amostra pequena fica neutra, para não sugerir conclusão. */
export function retentionTone(kind: RetentionKind, r: Pick<ReturnRate, 'rate' | 'sample'>, min: number): RetentionTone {
  if (r.rate === null || isThin(r, min)) return 'neutral';
  const b = RETENTION_BANDS[kind];
  if (r.rate >= b.good) return 'ok';
  if (r.rate >= b.attention) return 'warn';
  return 'bad';
}
