import { forbidden, notFound, validationError } from './errors.ts';
import type { EventPageService } from './event-page-service.ts';
import type { CoreDeps } from './ports.ts';
import type { PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

/** Até quantos acompanhantes o dono pode liberar por pessoa. */
export const GUEST_LIST_COMPANIONS_MAX = 5;
/** Maior limite de nomes que o dono pode definir. */
export const GUEST_LIST_LIMIT_MAX = 10_000;

export interface GuestListConfigView {
  limit: number | null;
  closesAt: string | null;
  maxCompanions: number;
}

export interface GuestListMineView {
  companions: number;
  checkedIn: boolean;
}

/** O que qualquer pessoa que abre o evento vê da lista. */
export interface GuestListView {
  enabled: boolean;
  /** Quem administra o local do evento (liga, vê e exporta a lista). */
  isOwner: boolean;
  config: GuestListConfigView | null;
  /** Nomes na lista (sem acompanhantes). Só aparece o total, nunca quem está. */
  count: number;
  /** Vagas que sobram (nulo: sem limite). */
  spotsLeft: number | null;
  /** Dá para entrar ou mudar agora: lista ligada, aberta e com vaga (ou eu já estou nela). */
  open: boolean;
  mine: GuestListMineView | null;
}

export interface GuestListEntryView {
  user: PublicProfile;
  companions: number;
  checkedIn: boolean;
  createdAt: string;
}

export interface GuestListOwnerView {
  config: GuestListConfigView;
  count: number;
  /** Nomes mais acompanhantes: quantas pessoas devem chegar. */
  people: number;
  checkedInPeople: number;
  entries: GuestListEntryView[];
}

export interface GuestListConfigInput {
  enabled?: unknown;
  limit?: unknown;
  closesAt?: unknown;
  maxCompanions?: unknown;
}

function intIn(value: unknown, min: number, max: number, field: string, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw validationError('Dados inválidos', { [field]: `${label}: use um número inteiro de ${min} a ${max}` });
  }
  return value;
}

/** Célula de CSV segura: aspas dobradas e, contra injeção de fórmula em planilhas, apóstrofo antes de = + - @. */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Lista VIP dos eventos de locais: quem administra o local liga a lista (com limite de nomes e horário de fechamento
 * opcionais); as pessoas põem o nome com acompanhantes; o dono vê, exporta em CSV e marca quem entrou. Sem pagamento.
 */
export class GuestListService {
  private readonly deps: CoreDeps;
  private readonly events: EventPageService;

  constructor(deps: CoreDeps, events: EventPageService) {
    this.deps = deps;
    this.events = events;
  }

  /** O evento que a pessoa pode abrir, o dono do local e quando termina. Evento de pessoa não tem lista. */
  private async target(viewerId: string, rawId: unknown) {
    const { ref, moderatorId, title } = await this.events.access(viewerId, rawId);
    if (ref.source !== 'PLACE') return { eventId: ref.id, ownerId: moderatorId, title, endsAt: null as Date | null, supported: false };
    const found = await this.deps.places.findEvent(ref.id);
    if (!found) throw notFound('Evento não encontrado');
    return { eventId: ref.id, ownerId: moderatorId, title, endsAt: found.event.endsAt as Date | null, supported: true };
  }

  private async ownerTarget(viewerId: string, rawId: unknown) {
    const t = await this.target(viewerId, rawId);
    if (!t.supported) throw notFound('A lista só existe em eventos de locais');
    if (t.ownerId === null || t.ownerId !== viewerId) throw forbidden('Só quem administra o local mexe na lista');
    return t;
  }

  private static config(list: { limit: number | null; closesAt: Date | null; maxCompanions: number }): GuestListConfigView {
    return { limit: list.limit, closesAt: list.closesAt ? list.closesAt.toISOString() : null, maxCompanions: list.maxCompanions };
  }

  private isClosed(list: { closesAt: Date | null }, endsAt: Date | null): boolean {
    const now = this.deps.clock.now();
    if (list.closesAt && now >= list.closesAt) return true;
    return endsAt !== null && now >= endsAt;
  }

  // ---------- Quem vai ----------

  async get(viewerId: string, rawId: unknown): Promise<GuestListView> {
    const t = await this.target(viewerId, rawId);
    const isOwner = t.ownerId !== null && t.ownerId === viewerId;
    const list = t.supported ? await this.deps.guestLists.get(t.eventId) : undefined;
    if (!list) return { enabled: false, isOwner, config: null, count: 0, spotsLeft: null, open: false, mine: null };
    const [count, mineEntry] = await Promise.all([this.deps.guestLists.count(t.eventId), this.deps.guestLists.find(t.eventId, viewerId)]);
    const spotsLeft = list.limit === null ? null : Math.max(0, list.limit - count);
    const open = !this.isClosed(list, t.endsAt) && (spotsLeft === null || spotsLeft > 0 || mineEntry !== undefined);
    return {
      enabled: true,
      isOwner,
      config: GuestListService.config(list),
      count,
      spotsLeft,
      open,
      mine: mineEntry ? { companions: mineEntry.companions, checkedIn: mineEntry.checkedInAt !== null } : null,
    };
  }

  /** Põe o nome na lista (ou muda os acompanhantes). Quem tem bloqueio com o dono do local não entra. */
  async join(viewerId: string, rawId: unknown, input: { companions?: unknown } = {}): Promise<GuestListView> {
    const t = await this.target(viewerId, rawId);
    const list = t.supported ? await this.deps.guestLists.get(t.eventId) : undefined;
    if (!list) throw notFound('Este evento não tem lista');
    if (t.ownerId !== null && t.ownerId !== viewerId && (await this.deps.blocks.existsEitherWay(viewerId, t.ownerId))) {
      throw forbidden('Não foi possível entrar na lista');
    }
    if (this.isClosed(list, t.endsAt)) throw forbidden('A lista já fechou');
    const companions = input.companions === undefined || input.companions === null ? 0 : intIn(input.companions, 0, list.maxCompanions, 'companions', 'Acompanhantes');
    const result = await this.deps.guestLists.join({ eventId: t.eventId, userId: viewerId, companions, at: this.deps.clock.now() }, list.limit);
    if (result === 'full') throw forbidden('A lista está cheia');
    if (result === 'created') {
      await this.deps.notifier.notify({
        userId: viewerId,
        type: 'GUEST_LIST',
        title: 'Seu nome está na lista',
        body: companions > 0 ? `"${t.title}" · você + ${companions}` : `"${t.title}"`,
        url: `/eventos/${t.eventId}`,
        dedupeKey: `guestlist:${t.eventId}`,
      });
    }
    return this.get(viewerId, t.eventId);
  }

  async leave(viewerId: string, rawId: unknown): Promise<GuestListView> {
    const t = await this.target(viewerId, rawId);
    if (t.supported) await this.deps.guestLists.leave(t.eventId, viewerId);
    return this.get(viewerId, t.eventId);
  }

  // ---------- Quem administra o local ----------

  /** Liga, ajusta ou desliga a lista. Desligar apaga os nomes. */
  async configure(ownerId: string, rawId: unknown, input: GuestListConfigInput): Promise<GuestListView> {
    const t = await this.ownerTarget(ownerId, rawId);
    if (typeof input.enabled !== 'boolean') throw validationError('Dados inválidos', { enabled: 'Informe se a lista fica ligada' });
    if (!input.enabled) {
      await this.deps.guestLists.remove(t.eventId);
      return this.get(ownerId, t.eventId);
    }
    const limit = input.limit === undefined || input.limit === null ? null : intIn(input.limit, 1, GUEST_LIST_LIMIT_MAX, 'limit', 'Limite de nomes');
    const maxCompanions = input.maxCompanions === undefined || input.maxCompanions === null ? 0 : intIn(input.maxCompanions, 0, GUEST_LIST_COMPANIONS_MAX, 'maxCompanions', 'Acompanhantes');
    let closesAt: Date | null = null;
    if (input.closesAt !== undefined && input.closesAt !== null && input.closesAt !== '') {
      const d = typeof input.closesAt === 'string' ? new Date(input.closesAt) : null;
      if (!d || Number.isNaN(d.getTime())) throw validationError('Dados inválidos', { closesAt: 'Horário de fechamento inválido' });
      closesAt = d;
    }
    const current = await this.deps.guestLists.get(t.eventId);
    // Reduzir o limite não tira quem já está; só impede novos nomes.
    await this.deps.guestLists.upsert({ eventId: t.eventId, limit, closesAt, maxCompanions, createdAt: current?.createdAt ?? this.deps.clock.now() });
    return this.get(ownerId, t.eventId);
  }

  /** Quem está na lista, sem quem tem bloqueio com o dono. */
  async entries(ownerId: string, rawId: unknown): Promise<GuestListOwnerView> {
    const t = await this.ownerTarget(ownerId, rawId);
    const list = await this.deps.guestLists.get(t.eventId);
    if (!list) throw notFound('Este evento não tem lista');
    const hidden = new Set(await this.deps.blocks.listRelatedIds(ownerId));
    const rows = (await this.deps.guestLists.list(t.eventId)).filter((e) => !hidden.has(e.userId));
    const profiles = new Map((await this.deps.users.findProfilesByIds(rows.map((r) => r.userId))).map((p) => [p.userId, toPublicProfile(p)]));
    const entries: GuestListEntryView[] = rows.flatMap((r) => {
      const user = profiles.get(r.userId);
      return user ? [{ user, companions: r.companions, checkedIn: r.checkedInAt !== null, createdAt: r.createdAt.toISOString() }] : [];
    });
    return {
      config: GuestListService.config(list),
      count: entries.length,
      people: entries.reduce((n, e) => n + 1 + e.companions, 0),
      checkedInPeople: entries.reduce((n, e) => n + (e.checkedIn ? 1 + e.companions : 0), 0),
      entries,
    };
  }

  /** Marca (ou desmarca) que a pessoa entrou. */
  async checkIn(ownerId: string, rawId: unknown, userId: unknown, checkedIn: unknown): Promise<GuestListOwnerView> {
    const t = await this.ownerTarget(ownerId, rawId);
    if (typeof userId !== 'string' || userId === '' || userId.length > 64) throw notFound('Pessoa não está na lista');
    if (typeof checkedIn !== 'boolean') throw validationError('Dados inválidos', { checkedIn: 'Informe se a pessoa entrou' });
    const ok = await this.deps.guestLists.setCheckedIn(t.eventId, userId, checkedIn ? this.deps.clock.now() : null);
    if (!ok) throw notFound('Pessoa não está na lista');
    return this.entries(ownerId, t.eventId);
  }

  /** A lista em CSV (nome, @usuário, acompanhantes, entrou), pronta para planilha. */
  async exportCsv(ownerId: string, rawId: unknown): Promise<{ filename: string; csv: string }> {
    const t = await this.ownerTarget(ownerId, rawId);
    const view = await this.entries(ownerId, t.eventId);
    const lines = [['Nome', 'Usuário', 'Acompanhantes', 'Entrou'].map(csvCell).join(',')];
    for (const e of view.entries) lines.push([csvCell(e.user.displayName), `"@${e.user.username}"`, String(e.companions), e.checkedIn ? 'sim' : 'não'].join(','));
    return { filename: `lista-${t.eventId}.csv`, csv: `﻿${lines.join('\r\n')}\r\n` };
  }
}
