import { validationError } from './errors.ts';
import { roundCoordinate } from './match.ts';
import type { CoreDeps } from './ports.ts';

export interface RegionView {
  /** Coordenada já arredondada (~1 km). */
  lat: number;
  lng: number;
  updatedAt: string;
}

/**
 * "Minha região": a pessoa diz, de forma opcional, mais ou menos onde mora para receber rolês que combinam com ela (Match).
 * Guardamos só a coordenada arredondada (cerca de 1 km), nunca a posição exata, e ela pode apagar quando quiser.
 * Sem região salva, a pessoa simplesmente não entra em nenhum Match.
 */
export class RegionService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async get(userId: string): Promise<{ region: RegionView | null }> {
    const r = await this.deps.regions.find(userId);
    return { region: r ? { lat: r.lat, lng: r.lng, updatedAt: r.updatedAt.toISOString() } : null };
  }

  async set(userId: string, input: { lat?: unknown; lng?: unknown }): Promise<{ region: RegionView }> {
    const { lat, lng } = input;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) throw validationError('Região inválida', { lat: 'Latitude entre -90 e 90' });
    if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) throw validationError('Região inválida', { lng: 'Longitude entre -180 e 180' });
    const updatedAt = this.deps.clock.now();
    const rounded = { lat: roundCoordinate(lat), lng: roundCoordinate(lng) };
    await this.deps.regions.upsert({ userId, ...rounded, updatedAt });
    return { region: { ...rounded, updatedAt: updatedAt.toISOString() } };
  }

  /** Apaga a região. Sem ela, nenhum Match chega para a pessoa. */
  async clear(userId: string): Promise<{ removed: boolean }> {
    return { removed: await this.deps.regions.delete(userId) };
  }
}
