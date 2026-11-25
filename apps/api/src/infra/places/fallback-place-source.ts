import type { PlaceSource } from '../../core/ports.ts';

/** Usa a fonte principal; se ela não responder ou não achar nada, tenta a reserva. */
export class FallbackPlaceSource implements PlaceSource {
  private readonly primary: PlaceSource;
  private readonly backup: PlaceSource;

  constructor(primary: PlaceSource, backup: PlaceSource) {
    this.primary = primary;
    this.backup = backup;
  }

  async nearby(center: { lat: number; lng: number }, radiusM: number, limit: number) {
    const first = await this.primary.nearby(center, radiusM, limit);
    if (first.available && first.places.length > 0) return first;
    const second = await this.backup.nearby(center, radiusM, limit);
    // Se a reserva também falhou, "indisponível" só vale quando as duas falharam.
    return { available: second.available || first.available, places: second.places };
  }

  /** Só existe busca paga quando a fonte principal (Google) sabe buscar por texto. */
  get premiumSearch(): boolean {
    return this.primary.premiumSearch === true && typeof this.primary.search === 'function';
  }

  /** A principal (Google) está sem cota agora: a busca segue só na reserva gratuita. */
  get premiumPaused(): boolean {
    return this.primary.premiumPaused === true;
  }

  /**
   * Busca por texto. Sem `premium`, só a reserva gratuita (OpenStreetMap). Com `premium` (a pessoa pediu "buscar no
   * Google"), a principal; se ela não responder ou bater no teto do dia, cai na reserva.
   */
  async search(text: string, center: { lat: number; lng: number } | undefined, limit: number, opts?: { premium?: boolean }) {
    if (opts?.premium && this.primary.search) {
      const first = await this.primary.search(text, center, limit, opts);
      if (first.available) return first;
    }
    if (this.backup.search) return this.backup.search(text, center, limit);
    if (!opts?.premium && this.primary.search && !this.primary.premiumSearch) return this.primary.search(text, center, limit);
    return { available: false, places: [] };
  }

  async lookup(externalId: string) {
    return (await this.primary.lookup?.(externalId)) ?? (await this.backup.lookup?.(externalId));
  }
}
