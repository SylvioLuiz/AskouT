/** O que o relatório do anúncio conta (mesmos valores do servidor). */
export type BoostStatKind = 'IMPRESSION' | 'OPEN' | 'TICKET';
/** Onde o cartão patrocinado apareceu. */
export type BoostPlacement = 'EXPLORE' | 'HOME' | 'MATCH' | 'EVENT_PAGE';

export interface BoostStatEntry {
  kind: BoostStatKind;
  placement: BoostPlacement;
  eventId?: string;
  venueId?: string;
}

/** Mesmo limite do servidor. */
export const BOOST_TRACK_BATCH_MAX = 20;
/** Tempo mínimo com o cartão visível (60% ou mais) para valer como exibição. */
export const SPONSORED_VIEW_MS = 1000;

/**
 * Fila do relatório do anúncio. Não depende de "Recomendações personalizadas": só conta números
 * (o servidor nunca guarda quem viu). Junta repetições do mesmo cartão para mandar uma vez só.
 */
export class BoostStatQueue {
  private readonly map = new Map<string, BoostStatEntry>();
  /** Já mandado nesta aba: rolar para cima e para baixo não reenvia. */
  private readonly sent = new Set<string>();

  add(entry: BoostStatEntry): void {
    if (!entry.eventId && !entry.venueId) return;
    const key = `${entry.kind}|${entry.placement}|${entry.eventId ?? ''}|${entry.venueId ?? ''}`;
    if (this.sent.has(key) || this.map.has(key)) return;
    this.map.set(key, entry);
  }

  get size(): number {
    return this.map.size;
  }

  drain(max = BOOST_TRACK_BATCH_MAX): BoostStatEntry[] {
    const out: BoostStatEntry[] = [];
    for (const [key, entry] of this.map) {
      if (out.length >= max) break;
      this.map.delete(key);
      this.sent.add(key);
      out.push(entry);
    }
    return out;
  }

  /** Esquece o que foi mandado (ex.: virou o dia ou trocou de conta). */
  reset(): void {
    this.map.clear();
    this.sent.clear();
  }
}
