import { validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { DwellRecord, DwellSource, DwellTarget } from './types.ts';

/** Quantas medições chegam por envio. */
export const DWELL_BATCH_MAX = 30;
/** Abaixo disso foi só passar a tela; acima do teto a aba provavelmente ficou aberta e esquecida. */
export const DWELL_MIN_MS = 500;
export const DWELL_MAX_MS = 120_000;
/** Por quanto tempo guardamos a medição (LGPD: só o necessário para recomendar). */
export const DWELL_RETENTION_DAYS = 60;

const TARGETS: readonly DwellTarget[] = ['POST', 'EVENT'];
const SOURCES: readonly DwellSource[] = ['FEED', 'RECO', 'OTHER'];

export interface DwellInput {
  targetType?: unknown;
  targetId?: unknown;
  ms?: unknown;
  source?: unknown;
  clicked?: unknown;
}

/** Recebe quanto tempo cada conteúdo ficou na tela e deixa a pessoa apagar tudo. */
export class DwellService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Medições fora do intervalo são ignoradas (não é erro: o app manda o que mediu). Devolve quantas ficaram. */
  async record(userId: string, items: unknown): Promise<{ saved: number }> {
    if (!Array.isArray(items) || items.length === 0 || items.length > DWELL_BATCH_MAX) {
      throw validationError('Envio inválido', { items: `Mande de 1 a ${DWELL_BATCH_MAX} medições` });
    }
    const now = this.deps.clock.now();
    const records: DwellRecord[] = [];
    for (const raw of items as DwellInput[]) {
      if (typeof raw !== 'object' || raw === null) throw validationError('Medição inválida', { items: 'Medição inválida' });
      const { targetType, targetId, ms, source, clicked } = raw;
      if (typeof targetType !== 'string' || !(TARGETS as readonly string[]).includes(targetType)) throw validationError('Medição inválida', { targetType: 'Use POST ou EVENT' });
      if (typeof targetId !== 'string' || targetId === '' || targetId.length > 64) throw validationError('Medição inválida', { targetId: 'Identificador inválido' });
      if (typeof ms !== 'number' || !Number.isFinite(ms)) throw validationError('Medição inválida', { ms: 'Tempo inválido' });
      const src = source === undefined ? 'OTHER' : source;
      if (typeof src !== 'string' || !(SOURCES as readonly string[]).includes(src)) throw validationError('Medição inválida', { source: 'Origem inválida' });
      if (clicked !== undefined && typeof clicked !== 'boolean') throw validationError('Medição inválida', { clicked: 'Use true ou false' });
      // O clique vale mesmo sem tempo de tela.
      if (ms < DWELL_MIN_MS && clicked !== true) continue;
      records.push({ id: this.deps.ids.next(), userId, targetType: targetType as DwellTarget, targetId, ms: Math.max(0, Math.min(DWELL_MAX_MS, Math.round(ms))), source: src as DwellSource, clicked: clicked === true, createdAt: now });
    }
    await this.deps.dwell.addMany(records);
    await this.deps.dwell.deleteOlderThan(userId, new Date(now.getTime() - DWELL_RETENTION_DAYS * 86_400_000));
    return { saved: records.length };
  }

  /** "Apagar meu histórico de recomendações". */
  async erase(userId: string): Promise<{ removed: number }> {
    return { removed: await this.deps.dwell.deleteByUser(userId) };
  }
}
