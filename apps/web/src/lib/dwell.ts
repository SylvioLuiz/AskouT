export type DwellTarget = 'POST' | 'EVENT';
export type DwellSource = 'FEED' | 'RECO' | 'OTHER';

export interface DwellEntry {
  targetType: DwellTarget;
  targetId: string;
  ms: number;
  source: DwellSource;
}

/** Mesmos limites do servidor. Abaixo do mínimo foi só passar a tela. */
export const DWELL_MIN_MS = 500;
export const DWELL_BATCH_MAX = 30;

/** Fila de medições: soma o tempo do mesmo conteúdo (rolar para fora e voltar) e entrega em lotes. */
export class DwellQueue {
  private readonly map = new Map<string, DwellEntry>();

  add(entry: DwellEntry): void {
    if (!Number.isFinite(entry.ms) || entry.ms <= 0 || !entry.targetId) return;
    const key = `${entry.targetType}|${entry.targetId}|${entry.source}`;
    const current = this.map.get(key);
    this.map.set(key, { ...entry, ms: Math.round((current?.ms ?? 0) + entry.ms) });
  }

  get size(): number {
    return this.map.size;
  }

  /** Tira até `max` medições da fila, ignorando as que somaram menos que o mínimo. */
  drain(max = DWELL_BATCH_MAX): DwellEntry[] {
    const out: DwellEntry[] = [];
    for (const [key, entry] of this.map) {
      if (out.length >= max) break;
      this.map.delete(key);
      if (entry.ms >= DWELL_MIN_MS) out.push(entry);
    }
    return out;
  }
}

/** Mede o tempo em que algo ficou visível: começa ao aparecer, para ao sair ou quando a aba some. */
export class VisibleTimer {
  private startedAt: number | undefined;

  start(nowMs: number): void {
    if (this.startedAt === undefined) this.startedAt = nowMs;
  }

  /** Para e devolve os ms desde o início (0 se não estava rodando). */
  stop(nowMs: number): number {
    if (this.startedAt === undefined) return 0;
    const ms = Math.max(0, nowMs - this.startedAt);
    this.startedAt = undefined;
    return ms;
  }

  get running(): boolean {
    return this.startedAt !== undefined;
  }
}

// ---------- Preferência da pessoa ----------

const keyOf = (userId: string) => `askout.personalize.${userId}`;

/** Recomendações usando o comportamento da pessoa. Ligado por padrão; ela pode desligar em Privacidade. */
export function readPersonalize(userId: string, storage: Pick<Storage, 'getItem'> | undefined = safe()): boolean {
  try {
    return storage?.getItem(keyOf(userId)) !== 'off';
  } catch {
    return true;
  }
}

export function savePersonalize(userId: string, on: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safe()): void {
  try {
    if (on) storage?.removeItem(keyOf(userId));
    else storage?.setItem(keyOf(userId), 'off');
  } catch {
    /* sem armazenamento: vale só nesta visita */
  }
}

function safe(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
