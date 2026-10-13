import { conflict, forbidden, notFound, rateLimited, validationError } from './errors.ts';
import { buildMeetupViews } from './meetup-view.ts';
import type { MeetupView } from './meetup-view.ts';
import type { CoreDeps } from './ports.ts';
import type { MeetupRecord, MessageRecord } from './types.ts';

export const MEETUP_MAX_GUESTS = 15;
export const MEETUP_NAME_MAX = 60;
export const MEETUPS_PER_HOUR = 10;

// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

export interface CreateMeetupInput {
  eventId?: unknown;
  guestIds?: unknown;
  /** Nome do grupo (só vale quando há mais de um convidado). Padrão: o título do evento. */
  name?: unknown;
}

/**
 * Encontro: nasce de um evento. Com um convidado vive na conversa 1 a 1; com vários cria um grupo.
 * Quem é convidado só entra no grupo ao aceitar.
 */
export class MeetupService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  async create(actorId: string, input: CreateMeetupInput): Promise<MeetupView> {
    const { places, follows, blocks, conversations, meetups, clock, ids } = this.deps;

    if (typeof input.eventId !== 'string' || input.eventId === '' || input.eventId.length > 64) throw validationError('Evento inválido', { eventId: 'Escolha um evento' });
    if (!Array.isArray(input.guestIds)) throw validationError('Escolha quem convidar', { guestIds: 'Escolha ao menos uma pessoa' });
    const guestIds = [...new Set(input.guestIds)];
    if (guestIds.length === 0) throw validationError('Escolha quem convidar', { guestIds: 'Escolha ao menos uma pessoa' });
    if (guestIds.length > MEETUP_MAX_GUESTS) throw validationError(`No máximo ${MEETUP_MAX_GUESTS} convidados`, { guestIds: `No máximo ${MEETUP_MAX_GUESTS} convidados` });
    for (const g of guestIds) {
      if (typeof g !== 'string' || g === '' || g.length > 64) throw validationError('Pessoa inválida', { guestIds: 'Pessoa inválida' });
      if (g === actorId) throw validationError('Você já participa do seu encontro', { guestIds: 'Não convide a si mesmo' });
    }
    const guests = guestIds as string[];

    let name: string | null = null;
    if (input.name !== undefined && input.name !== null && input.name !== '') {
      if (typeof input.name !== 'string' || CONTROL_RE.test(input.name) || Array.from(input.name.trim()).length > MEETUP_NAME_MAX || input.name.trim() === '') {
        throw validationError('Nome inválido', { name: `Use até ${MEETUP_NAME_MAX} caracteres` });
      }
      name = input.name.trim();
    }

    const found = await places.findEvent(input.eventId);
    if (!found) throw notFound('Evento não encontrado');
    const now = clock.now();
    if (found.event.endsAt <= now) throw validationError('Esse evento já terminou', { eventId: 'Esse evento já terminou' });

    const [friends, related] = await Promise.all([follows.listFriendIds(actorId), blocks.listRelatedIds(actorId)]);
    for (const g of guests) {
      if (related.includes(g)) throw notFound('Pessoa não encontrada');
      if (!friends.includes(g)) throw forbidden('Só amigos podem ser convidados');
    }

    if ((await meetups.countCreatedSince(actorId, new Date(now.getTime() - 3_600_000))) >= MEETUPS_PER_HOUR) {
      throw rateLimited('Você criou muitos encontros em pouco tempo. Tente de novo daqui a pouco.', 600);
    }

    const title = found.event.title;
    const conversation =
      guests.length === 1
        ? await conversations.getOrCreateDirect(actorId, guests[0] as string, ids.next(), now)
        : await conversations.createGroup({ id: ids.next(), name: name ?? title, ownerId: actorId, now });

    const meetup: MeetupRecord = {
      id: ids.next(),
      organizerId: actorId,
      conversationId: conversation.id,
      eventId: found.event.id,
      title,
      startsAt: found.event.startsAt,
      endsAt: found.event.endsAt,
      createdAt: now,
      participants: [{ userId: actorId, status: 'CONFIRMED', respondedAt: now }, ...guests.map((userId) => ({ userId, status: 'INVITED' as const, respondedAt: null }))],
    };
    await meetups.create(meetup);

    const card = (conversationId: string): MessageRecord => ({
      id: ids.next(),
      conversationId,
      senderId: actorId,
      kind: 'MEETUP',
      body: `Encontro: ${title}`,
      suggestion: null,
      response: null,
      respondedAt: null,
      meetupId: meetup.id,
      createdAt: now,
    });
    // Um convidado: o convite é o cartão na conversa 1 a 1. Vários: o cartão fica no grupo e cada convidado
    // recebe o convite na conversa 1 a 1 com quem organiza (ele só entra no grupo ao aceitar).
    await this.deps.conversations.addMessage(card(conversation.id));
    await conversations.markRead(conversation.id, actorId, now);
    if (guests.length > 1) {
      for (const g of guests) {
        const direct = await conversations.getOrCreateDirect(actorId, g, ids.next(), now);
        await conversations.addMessage(card(direct.id));
        await conversations.markRead(direct.id, actorId, now);
      }
    }
    const [view] = await buildMeetupViews(this.deps, actorId, [meetup]);
    if (!view) throw notFound('Encontro não encontrado');
    return view;
  }

  /** Só quem organiza ou foi convidado vê o encontro. */
  async get(actorId: string, meetupId: string): Promise<MeetupView> {
    const meetup = await this.visible(actorId, meetupId);
    const [view] = await buildMeetupViews(this.deps, actorId, [meetup]);
    if (!view) throw notFound('Encontro não encontrado');
    return view;
  }

  /** O convidado aceita ou recusa. Aceitar num grupo coloca a pessoa no grupo. */
  async respond(actorId: string, meetupId: string, action: unknown): Promise<MeetupView> {
    if (action !== 'accept' && action !== 'decline') throw validationError('Ação inválida', { action: 'Use accept ou decline' });
    const { meetups, conversations, blocks, clock } = this.deps;
    const meetup = await this.visible(actorId, meetupId);
    const mine = meetup.participants.find((p) => p.userId === actorId);
    if (!mine || meetup.organizerId === actorId) throw forbidden('Quem organiza já participa do encontro');
    if (mine.status !== 'INVITED') throw conflict('Você já respondeu a esse convite');
    const now = clock.now();
    if (meetup.endsAt <= now) throw conflict('Esse encontro já aconteceu');
    if (await blocks.existsEitherWay(actorId, meetup.organizerId)) throw notFound('Encontro não encontrado');
    const status = action === 'accept' ? 'CONFIRMED' : 'DECLINED';
    if (!(await meetups.respond(meetupId, actorId, status, now))) throw conflict('Você já respondeu a esse convite');
    if (status === 'CONFIRMED') {
      const conversation = await conversations.findById(meetup.conversationId);
      if (conversation?.type === 'GROUP') await conversations.addParticipant(conversation.id, actorId, now);
    }
    return this.get(actorId, meetupId);
  }

  private async visible(actorId: string, meetupId: string): Promise<MeetupRecord> {
    const meetup = typeof meetupId === 'string' && meetupId.length <= 64 ? await this.deps.meetups.find(meetupId) : undefined;
    if (!meetup || !meetup.participants.some((p) => p.userId === actorId)) throw notFound('Encontro não encontrado');
    return meetup;
  }
}
