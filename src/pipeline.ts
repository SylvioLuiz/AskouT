import { score, type ScoreContext } from './confidence.ts';
import { dedupKey } from './dedup.ts';
import type { Candidate, Decision } from './types.ts';

export interface Evaluated { key: string; candidate: Candidate; total: number; decision: Decision; reasons: string[] }

export interface PipelineOptions {
  /** observation: nunca publica; tudo que passaria vai para REVIEW. */
  mode: 'observation' | 'publish';
  minConfidence: number;
}

/** Decide o destino de cada candidato. Evento sem local fica à parte (NO_VENUE), por decisão do Sylvio; liberar depois. */
export function evaluate(c: Candidate, ctx: ScoreContext, opt: PipelineOptions): Evaluated {
  const { total } = score(c, ctx);
  const reasons: string[] = [];
  let decision: Decision;
  if (!c.venueName) { decision = 'NO_VENUE'; reasons.push('sem local'); }
  else if (!ctx.venueMatched) { decision = 'REVIEW'; reasons.push('local não encontrado no AskouT'); }
  else if (total < opt.minConfidence) { decision = 'REVIEW'; reasons.push(`confiança ${total} abaixo de ${opt.minConfidence}`); }
  else if (opt.mode === 'observation') { decision = 'REVIEW'; reasons.push('modo observação'); }
  else decision = 'PUBLISH';
  return { key: dedupKey(c), candidate: c, total, decision, reasons };
}
