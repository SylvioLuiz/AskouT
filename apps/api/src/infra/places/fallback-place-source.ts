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
}
