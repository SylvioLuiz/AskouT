import { conflict, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { CloakroomSettingRecord, CloakroomStatus, CloakroomTicketRecord, PlaceEventRecord, PublicProfile, VenueRecord } from './types.ts';

export const CLOAKROOM_DESCRIPTION_MAX = 80;
export const CLOAKROOM_NOTE_MAX = 200;
export const CLOAKROOM_ITEMS_MAX = 10;
/** Tickets abertos (emitidos ou guardados) que uma pessoa pode ter no mesmo evento. */
export const CLOAKROOM_OPEN_TICKETS_MAX = 3;
export const CLOAKROOM_PRICE_MAX_CENTS = 100_000;
export const CLOAKROOM_CAPACITY_MAX = 10_000;

export interface CloakroomTicketView {
  id: string;
  number: number;
  code: string;
  description: string;
  itemCount: number;
  status: CloakroomStatus;
  createdAt: string;
  storedAt: string | null;
  returnedAt: string | null;
}

export interface CloakroomSettingView {
  enabled: boolean;
  priceCents: number | null;
  capacity: number | null;
  note: string | null;
}

export interface CloakroomStats {
  /** Tickets emitidos que ainda não entregaram os itens. */
  waiting: number;
  /** Tickets com itens guardados agora. */
  stored: number;
  returned: number;
  /** Itens ocupando a chapelaria (emitidos + guardados). */
  itemsInUse: number;
  capacity: number | null;
}

/** O que o participante vê na página do evento. */
export interface CloakroomPublicView {
  enabled: boolean;
  priceCents: number | null;
  capacity: number | null;
  note: string | null;
  /** Lotada: não cabem mais itens. */
  full: boolean;
  /** Vagas restantes (itens), se houver limite. */
  spotsLeft: number | null;
  /** Ainda dá para pedir ticket (ligada, não lotada, evento não terminou). */
  canRequest: boolean;
  mine: CloakroomTicketView[];
}

export interface CloakroomStaffTicket extends CloakroomTicketView {
  owner: Pick<PublicProfile, 'userId' | 'username' | 'displayName' | 'avatarUrl'> | null;
}

/** Painel de quem organiza. */
export interface CloakroomPanel {
  event: { id: string; title: string; startsAt: string; endsAt: string };
  setting: CloakroomSettingView;
  stats: CloakroomStats;
  tickets: CloakroomStaffTicket[];
}

export interface CloakroomSettingInput {
  enabled?: unknown;
  priceCents?: unknown;
  capacity?: unknown;
  note?: unknown;
}

const OPEN: readonly CloakroomStatus[] = ['ISSUED', 'STORED'];

function optionalInt(value: unknown, field: string, label: string, max: number): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) throw validationError(`${label} inválido`, { [field]: `Use um número inteiro de 0 a ${max}` });
  return value;
}

function normalizeCode(value: unknown): string {
  const code = typeof value === 'string' ? value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  if (code === '' || code.length > 16) throw validationError('Informe o código do ticket', { code: 'Código inválido' });
  return code;
}

/**
 * Chapelaria (guarda-volumes) de evento. Quem organiza (responsável pelo local) liga no evento, a pessoa pede um ticket
 * com o código, a equipe confere o código ao receber e ao devolver os itens. Nenhum pagamento passa pelo app:
 * o preço é só informativo e cobrado na porta.
 */
export class CloakroomService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  // ---------------------------------------------------------------- organização

  async panel(userId: string, venueId: unknown, eventId: unknown): Promise<CloakroomPanel> {
    const event = await this.ownedEvent(userId, venueId, eventId);
    return this.buildPanel(event);
  }

  async configure(userId: string, venueId: unknown, eventId: unknown, input: CloakroomSettingInput): Promise<CloakroomPanel> {
    const event = await this.ownedEvent(userId, venueId, eventId);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw validationError('Dados inválidos');
    if (typeof input.enabled !== 'boolean') throw validationError('Informe se a chapelaria fica ligada', { enabled: 'Use true ou false' });
    const priceCents = optionalInt(input.priceCents, 'priceCents', 'Preço', CLOAKROOM_PRICE_MAX_CENTS);
    const capacity = optionalInt(input.capacity, 'capacity', 'Limite', CLOAKROOM_CAPACITY_MAX);
    if (capacity === 0) throw validationError('Limite inválido', { capacity: 'O limite precisa ser de pelo menos 1 item' });
    let note: string | null = null;
    if (input.note !== undefined && input.note !== null) {
      if (typeof input.note !== 'string') throw validationError('Aviso inválido', { note: 'Texto inválido' });
      note = input.note.trim() || null;
      if (note && note.length > CLOAKROOM_NOTE_MAX) throw validationError('Aviso muito longo', { note: `Até ${CLOAKROOM_NOTE_MAX} caracteres` });
    }
    await this.deps.cloakroom.saveSetting({ placeEventId: event.id, enabled: input.enabled, priceCents: priceCents === 0 ? null : priceCents, capacity, note });
    return this.buildPanel(event);
  }

  /** Equipe confere o código e marca que os itens foram entregues e estão guardados. */
  async receive(userId: string, venueId: unknown, eventId: unknown, code: unknown): Promise<CloakroomStaffTicket> {
    const event = await this.ownedEvent(userId, venueId, eventId);
    const ticket = await this.ticketByCode(event.id, code);
    if (ticket.status === 'STORED') throw conflict('Estes itens já estão guardados');
    if (ticket.status !== 'ISSUED') throw conflict(ticket.status === 'RETURNED' ? 'Estes itens já foram retirados' : 'Este ticket foi cancelado');
    const next: CloakroomTicketRecord = { ...ticket, status: 'STORED', storedAt: this.deps.clock.now() };
    await this.deps.cloakroom.updateTicket(next);
    return this.staffView(next);
  }

  /** Equipe confere o código e marca a retirada dos itens. */
  async giveBack(userId: string, venueId: unknown, eventId: unknown, code: unknown): Promise<CloakroomStaffTicket> {
    const event = await this.ownedEvent(userId, venueId, eventId);
    const ticket = await this.ticketByCode(event.id, code);
    if (ticket.status === 'RETURNED') throw conflict('Estes itens já foram retirados');
    if (ticket.status !== 'STORED') throw conflict(ticket.status === 'ISSUED' ? 'Os itens deste ticket ainda não foram entregues' : 'Este ticket foi cancelado');
    const next: CloakroomTicketRecord = { ...ticket, status: 'RETURNED', returnedAt: this.deps.clock.now() };
    await this.deps.cloakroom.updateTicket(next);
    return this.staffView(next);
  }

  /** Consulta um código sem mudar nada (a equipe vê quem é e o que guardou). */
  async lookup(userId: string, venueId: unknown, eventId: unknown, code: unknown): Promise<CloakroomStaffTicket> {
    const event = await this.ownedEvent(userId, venueId, eventId);
    return this.staffView(await this.ticketByCode(event.id, code));
  }

  // ---------------------------------------------------------------- participante

  async publicView(userId: string, eventId: unknown): Promise<CloakroomPublicView> {
    const found = await this.eventOrThrow(eventId);
    const setting = await this.deps.cloakroom.findSetting(found.id);
    if (!setting || !setting.enabled) return { enabled: false, priceCents: null, capacity: null, note: null, full: false, spotsLeft: null, canRequest: false, mine: [] };
    const used = this.itemsInUse(await this.deps.cloakroom.listByEvent(found.id));
    const spotsLeft = setting.capacity === null ? null : Math.max(0, setting.capacity - used);
    const full = spotsLeft === 0;
    const over = found.endsAt.getTime() <= this.deps.clock.now().getTime();
    const mine = await this.deps.cloakroom.listByUser(userId, found.id);
    return { enabled: true, priceCents: setting.priceCents, capacity: setting.capacity, note: setting.note, full, spotsLeft, canRequest: !full && !over, mine: mine.map((t) => this.view(t)) };
  }

  /** `{description, itemCount}`: pede o ticket da chapelaria. O código aparece para mostrar à equipe. */
  async request(userId: string, eventId: unknown, input: { description?: unknown; itemCount?: unknown }): Promise<CloakroomTicketView> {
    const found = await this.eventOrThrow(eventId);
    const setting = await this.deps.cloakroom.findSetting(found.id);
    if (!setting || !setting.enabled) throw notFound('Este evento não tem chapelaria');
    if (found.endsAt.getTime() <= this.deps.clock.now().getTime()) throw conflict('O evento já terminou');
    if (typeof input !== 'object' || input === null) throw validationError('Dados inválidos');
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (description === '' || description.length > CLOAKROOM_DESCRIPTION_MAX) throw validationError('Descreva o que vai guardar', { description: `Informe de 1 a ${CLOAKROOM_DESCRIPTION_MAX} caracteres` });
    const itemCount = input.itemCount === undefined ? 1 : input.itemCount;
    if (typeof itemCount !== 'number' || !Number.isInteger(itemCount) || itemCount < 1 || itemCount > CLOAKROOM_ITEMS_MAX) throw validationError('Quantidade inválida', { itemCount: `Use de 1 a ${CLOAKROOM_ITEMS_MAX} itens` });
    const all = await this.deps.cloakroom.listByEvent(found.id);
    if (all.filter((t) => t.userId === userId && OPEN.includes(t.status)).length >= CLOAKROOM_OPEN_TICKETS_MAX) throw conflict(`Você já tem ${CLOAKROOM_OPEN_TICKETS_MAX} tickets abertos neste evento`);
    if (setting.capacity !== null && this.itemsInUse(all) + itemCount > setting.capacity) throw conflict('A chapelaria está lotada');
    const taken = new Set(all.map((t) => t.code));
    let code = this.newCode();
    while (taken.has(code)) code = this.newCode();
    const ticket = await this.deps.cloakroom.createTicket({ id: this.deps.ids.next(), placeEventId: found.id, userId, code, description, itemCount, status: 'ISSUED', createdAt: this.deps.clock.now(), storedAt: null, returnedAt: null });
    return this.view(ticket);
  }

  /** A pessoa desiste do ticket enquanto os itens ainda não foram entregues. */
  async cancel(userId: string, ticketId: unknown): Promise<CloakroomTicketView> {
    const ticket = typeof ticketId === 'string' && ticketId.length <= 64 ? await this.deps.cloakroom.findTicket(ticketId) : undefined;
    if (!ticket || ticket.userId !== userId) throw notFound('Ticket não encontrado');
    if (ticket.status !== 'ISSUED') throw conflict(ticket.status === 'STORED' ? 'Os itens já foram entregues: peça a retirada à equipe' : 'Este ticket não pode ser cancelado');
    const next: CloakroomTicketRecord = { ...ticket, status: 'CANCELED' };
    await this.deps.cloakroom.updateTicket(next);
    return this.view(next);
  }

  /** Todos os tickets da pessoa (mais novos primeiro), com o nome do evento. */
  async mine(userId: string): Promise<(CloakroomTicketView & { event: { id: string; title: string } })[]> {
    const tickets = await this.deps.cloakroom.listByUser(userId);
    const out: (CloakroomTicketView & { event: { id: string; title: string } })[] = [];
    for (const t of tickets) {
      const found = await this.deps.places.findEvent(t.placeEventId);
      if (found) out.push({ ...this.view(t), event: { id: found.event.id, title: found.event.title } });
    }
    return out;
  }

  // ---------------------------------------------------------------- internos

  private newCode(): string {
    return this.deps.ids.next().replace(/[^a-zA-Z0-9]/g, '').slice(-6).toUpperCase().padStart(6, '0');
  }

  private itemsInUse(tickets: CloakroomTicketRecord[]): number {
    return tickets.filter((t) => OPEN.includes(t.status)).reduce((sum, t) => sum + t.itemCount, 0);
  }

  private view(t: CloakroomTicketRecord): CloakroomTicketView {
    return { id: t.id, number: t.number, code: t.code, description: t.description, itemCount: t.itemCount, status: t.status, createdAt: t.createdAt.toISOString(), storedAt: t.storedAt?.toISOString() ?? null, returnedAt: t.returnedAt?.toISOString() ?? null };
  }

  private async staffView(t: CloakroomTicketRecord): Promise<CloakroomStaffTicket> {
    const [profile] = await this.deps.users.findProfilesByIds([t.userId]);
    return { ...this.view(t), owner: profile ? { userId: profile.userId, username: profile.username, displayName: profile.displayName, avatarUrl: profile.avatarUrl } : null };
  }

  private async buildPanel(event: PlaceEventRecord): Promise<CloakroomPanel> {
    const setting = (await this.deps.cloakroom.findSetting(event.id)) ?? { placeEventId: event.id, enabled: false, priceCents: null, capacity: null, note: null };
    const all = await this.deps.cloakroom.listByEvent(event.id);
    const profiles = new Map((await this.deps.users.findProfilesByIds([...new Set(all.map((t) => t.userId))])).map((p) => [p.userId, p]));
    const tickets = all.map((t): CloakroomStaffTicket => {
      const p = profiles.get(t.userId);
      return { ...this.view(t), owner: p ? { userId: p.userId, username: p.username, displayName: p.displayName, avatarUrl: p.avatarUrl } : null };
    });
    return {
      event: { id: event.id, title: event.title, startsAt: event.startsAt.toISOString(), endsAt: event.endsAt.toISOString() },
      setting: this.settingView(setting),
      stats: {
        waiting: all.filter((t) => t.status === 'ISSUED').length,
        stored: all.filter((t) => t.status === 'STORED').length,
        returned: all.filter((t) => t.status === 'RETURNED').length,
        itemsInUse: this.itemsInUse(all),
        capacity: setting.capacity,
      },
      tickets,
    };
  }

  private settingView(s: CloakroomSettingRecord): CloakroomSettingView {
    return { enabled: s.enabled, priceCents: s.priceCents, capacity: s.capacity, note: s.note };
  }

  private async eventOrThrow(eventId: unknown): Promise<PlaceEventRecord> {
    const found = typeof eventId === 'string' && eventId !== '' && eventId.length <= 64 ? await this.deps.places.findEvent(eventId) : undefined;
    if (!found) throw notFound('Evento não encontrado');
    return found.event;
  }

  /** Quem não é responsável pelo local recebe "não encontrado", como no painel do local. */
  private async ownedEvent(userId: string, venueId: unknown, eventId: unknown): Promise<PlaceEventRecord> {
    const venue: VenueRecord | undefined = typeof venueId === 'string' && venueId !== '' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue || venue.ownerId !== userId) throw notFound('Local não encontrado');
    const event = await this.eventOrThrow(eventId);
    if (event.venueId !== venue.id) throw notFound('Evento não encontrado');
    return event;
  }

  private async ticketByCode(placeEventId: string, code: unknown): Promise<CloakroomTicketRecord> {
    const ticket = await this.deps.cloakroom.findTicketByCode(placeEventId, normalizeCode(code));
    if (!ticket) throw notFound('Ticket não encontrado');
    return ticket;
  }
}
