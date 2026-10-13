import { notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

export class BlockService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /**
   * Bloqueia e revoga os acessos: remove seguimentos e solicitações nos dois sentidos,
   * o que também encerra a amizade. Idempotente.
   *
   * A ordem importa: o bloqueio é gravado primeiro. Se o passo seguinte falhar, o estado
   * continua seguro (a regra de amizade e as listas já respeitam o bloqueio) e repetir é inofensivo.
   */
  async block(actorId: string, targetId: string): Promise<void> {
    if (actorId === targetId) throw validationError('Você não pode bloquear a si mesmo');
    const { users, blocks, follows, flash, clock } = this.deps;
    const target = await users.findById(targetId);
    if (!target) throw notFound('Usuário não encontrado');

    await blocks.add(actorId, targetId, clock.now());
    await follows.deleteBetween(actorId, targetId);
    // Convites e encontros do Flash entre os dois terminam e a posição some.
    await flash.closeOpenInvitesBetween(actorId, targetId, clock.now());
  }

  /** Remove só o bloqueio. Os seguimentos removidos não voltam. Idempotente. */
  async unblock(actorId: string, targetId: string): Promise<{ removed: boolean }> {
    return { removed: await this.deps.blocks.remove(actorId, targetId) };
  }

  async list(actorId: string): Promise<PublicProfile[]> {
    const ids = await this.deps.blocks.listBlockedBy(actorId);
    const profiles = await this.deps.users.findProfilesByIds(ids);
    return profiles.map(toPublicProfile);
  }
}
