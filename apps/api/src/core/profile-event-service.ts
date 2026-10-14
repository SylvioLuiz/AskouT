import { buildEventCards } from './event-card.ts';
import type { EventCardView } from './event-card.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ProfileService } from './profile-service.ts';

export const POSTED_EVENTS_MAX = 200;
export const POSTED_PAGE_DEFAULT = 30;
export const POSTED_PAGE_MAX = 60;

export interface PostedEventView extends EventCardView {
  postedAt: string;
}

export interface PostedEventsPage {
  items: PostedEventView[];
  total: number;
  limit: number;
  offset: number;
}

function parsePage(raw: { limit?: unknown; offset?: unknown }): { limit: number; offset: number } {
  const num = (v: unknown, def: number, min: number, max: number, field: string) => {
    if (v === undefined || v === null || v === '') return def;
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : Number.NaN;
    if (!Number.isInteger(n) || n < min || n > max) throw validationError('Valor inválido', { [field]: `Use um inteiro entre ${min} e ${max}` });
    return n;
  };
  return { limit: num(raw.limit, POSTED_PAGE_DEFAULT, 1, POSTED_PAGE_MAX, 'limit'), offset: num(raw.offset, 0, 0, 1_000_000, 'offset') };
}

/** Eventos que a pessoa decidiu postar no perfil: postar, tirar e listar (respeitando perfil privado e bloqueio). */
export class ProfileEventService {
  private readonly deps: CoreDeps;
  private readonly profiles: ProfileService;

  constructor(deps: CoreDeps, profiles: ProfileService) {
    this.deps = deps;
    this.profiles = profiles;
  }

  async post(actorId: string, eventId: unknown): Promise<{ posted: true }> {
    const { places, profileEvents, clock } = this.deps;
    if (typeof eventId !== 'string' || eventId === '' || eventId.length > 64) throw notFound('Evento não encontrado');
    if (!(await places.findEvent(eventId))) throw notFound('Evento não encontrado');
    if ((await profileEvents.count(actorId)) >= POSTED_EVENTS_MAX && !(await profileEvents.has(actorId, eventId))) {
      throw conflict(`Você já postou ${POSTED_EVENTS_MAX} eventos. Tire algum do perfil para postar outro.`);
    }
    await profileEvents.add(actorId, eventId, clock.now());
    return { posted: true };
  }

  async unpost(actorId: string, eventId: unknown): Promise<{ posted: false }> {
    if (typeof eventId !== 'string' || eventId === '' || eventId.length > 64) throw notFound('Evento não encontrado');
    await this.deps.profileEvents.remove(actorId, eventId);
    return { posted: false };
  }

  /** Eventos postados por `username`, vistos por `viewerId`. Perfil privado só para quem segue (ou o próprio). */
  async list(viewerId: string, username: unknown, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostedEventsPage> {
    const view = await this.profiles.getByUsername(viewerId, username);
    if (view.relationship.blockedByViewer) throw notFound('Usuário não encontrado');
    if (!view.canViewContent) throw forbidden('Esta conta é privada');
    const page = parsePage(query);
    const { profileEvents } = this.deps;
    const [rows, total] = await Promise.all([profileEvents.list(view.profile.userId, page), profileEvents.count(view.profile.userId)]);
    const cards = await buildEventCards(this.deps, rows.map((r) => r.eventId));
    const items: PostedEventView[] = rows.flatMap((r) => {
      const card = cards.get(r.eventId);
      return card ? [{ ...card, postedAt: r.createdAt.toISOString() }] : [];
    });
    return { items, total, ...page };
  }
}
