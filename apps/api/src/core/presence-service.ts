import { validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';

/** Sem sinal do app por mais que isso, a pessoa deixa de aparecer online. O app avisa a cada 30 s com a tela aberta. */
export const ONLINE_WINDOW_MS = 75_000;
/** Teto de pessoas conferidas por vez fora da lista de amigos (conversas 1 a 1), para a consulta continuar leve. */
const MAX_DIRECT_CHECKS = 200;

export interface PresenceSettingsView {
  showOnline: boolean;
}

/**
 * Bolinha verde de online. Leve de propósito: quem está com o app aberto fica só na memória do servidor
 * (um carimbo de hora por pessoa), renovado pelo próprio app enquanto a tela está visível.
 *
 * Quem vê a bolinha de alguém: os amigos (seguem um ao outro, sem bloqueio) e quem tem conversa 1 a 1 liberada
 * com a pessoa (não vale solicitação pendente nem bloqueio). Quem esconde a própria bolinha também não vê a dos outros.
 */
export class PresenceService {
  private readonly deps: CoreDeps;
  private readonly lastSeen = new Map<string, number>();

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** O app está aberto e visível para essa pessoa agora. */
  touch(userId: string): void {
    const now = this.deps.clock.now().getTime();
    this.lastSeen.set(userId, now);
    // Faxina de quem saiu há muito tempo, para o mapa não crescer sem limite.
    if (this.lastSeen.size > 1000 && Math.random() < 0.01) {
      for (const [id, at] of this.lastSeen) if (now - at > ONLINE_WINDOW_MS * 4) this.lastSeen.delete(id);
    }
  }

  /** A pessoa saiu do app (tela escondida ou fechada): some na hora, sem esperar o tempo acabar. */
  leave(userId: string): void {
    this.lastSeen.delete(userId);
  }

  private onlineNow(): string[] {
    const now = this.deps.clock.now().getTime();
    const ids: string[] = [];
    for (const [id, at] of this.lastSeen) if (now - at <= ONLINE_WINDOW_MS) ids.push(id);
    return ids;
  }

  /** Marca quem pergunta como online e devolve quem ele pode ver online agora (nunca inclui ele mesmo). */
  async heartbeat(actorId: string): Promise<string[]> {
    this.touch(actorId);
    return this.visibleOnline(actorId);
  }

  async visibleOnline(actorId: string): Promise<string[]> {
    const { conversations, follows, blocks } = this.deps;
    const candidates = this.onlineNow().filter((id) => id !== actorId);
    if (candidates.length === 0) return [];
    if (!(await conversations.getShowOnline(actorId))) return [];
    const hidden = new Set(await conversations.listHiddenOnline(candidates));
    const visibleCandidates = candidates.filter((id) => !hidden.has(id));
    if (visibleCandidates.length === 0) return [];

    const friends = new Set(await follows.listFriendIds(actorId));
    const result = visibleCandidates.filter((id) => friends.has(id));
    const others = visibleCandidates.filter((id) => !friends.has(id)).slice(0, MAX_DIRECT_CHECKS);
    if (others.length > 0) {
      const blocked = new Set(await blocks.listRelatedIds(actorId));
      for (const id of others) {
        if (blocked.has(id)) continue;
        const direct = await conversations.findDirect(actorId, id);
        if (!direct || direct.venueId) continue;
        // Solicitação de mensagem ainda não aceita não revela quem está online.
        if (direct.requestToId && !direct.acceptedAt) continue;
        result.push(id);
      }
    }
    return result;
  }

  async settings(actorId: string): Promise<PresenceSettingsView> {
    return { showOnline: await this.deps.conversations.getShowOnline(actorId) };
  }

  async setSettings(actorId: string, input: { showOnline?: unknown }): Promise<PresenceSettingsView> {
    if (typeof input.showOnline !== 'boolean') throw validationError('Valor inválido', { showOnline: 'Use true ou false' });
    await this.deps.conversations.setShowOnline(actorId, input.showOnline);
    return { showOnline: input.showOnline };
  }
}
