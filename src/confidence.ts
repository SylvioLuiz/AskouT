import type { Candidate, ScoreBreakdown } from './types.ts';

/** Pesos iniciais decididos pelo Sylvio (somam 100). Configuráveis. */
export const DEFAULT_WEIGHTS: ScoreBreakdown = { dateTime: 25, venue: 25, officialSource: 20, image: 15, coherence: 10, multipleSources: 5 };

export interface ScoreContext {
  /** Local encontrado no AskouT (por /hunter/venues). */
  venueMatched: boolean;
  /** Em quantas fontes diferentes o mesmo evento apareceu. */
  sourceCount: number;
  now?: Date;
}

function validHttps(u?: string): boolean {
  if (!u) return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

/** Nota 0–100 e o detalhe por critério. Sem imagem https válida, a nota nunca chega a 90 com os pesos padrão. */
export function score(c: Candidate, ctx: ScoreContext, weights: ScoreBreakdown = DEFAULT_WEIGHTS): { total: number; breakdown: ScoreBreakdown } {
  const now = ctx.now ?? new Date();
  const start = c.startsAt ? Date.parse(c.startsAt) : NaN;
  const end = c.endsAt ? Date.parse(c.endsAt) : NaN;
  const dateOk = !Number.isNaN(start) && start > now.getTime() && (Number.isNaN(end) || end > start);
  const coherent = c.title.trim().length >= 3 && c.title.length <= 120 && (c.description ?? '').length <= 1500 && (Number.isNaN(start) || start - now.getTime() < 366 * 86_400_000);
  const breakdown: ScoreBreakdown = {
    dateTime: dateOk ? weights.dateTime : 0,
    venue: ctx.venueMatched ? weights.venue : 0,
    officialSource: c.officialSource ? weights.officialSource : 0,
    image: validHttps(c.imageUrl) ? weights.image : 0,
    coherence: coherent ? weights.coherence : 0,
    multipleSources: ctx.sourceCount >= 2 ? weights.multipleSources : 0,
  };
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { total, breakdown };
}
