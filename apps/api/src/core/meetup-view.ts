import type { CoreDeps } from './ports.ts';
import type { EventKind, MeetupRecord, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

export interface MeetupView {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  organizer: PublicProfile;
  /** ID oculto do evento de origem (de bar ou criado por pessoa), para o app saber que é o mesmo evento mesmo que o nome mude. Nulo se não veio de evento. */
  eventRef: string | null;
  /** Evento do AskouT de onde o encontro saiu; nulo se foi apagado. */
  event: {
    id: string;
    venueId: string;
    venueName: string;
    address: string | null;
    kind: EventKind;
    imageUrl: string | null;
    isFree: boolean;
    /** Dado de exemplo para teste, nunca um evento real. */
    sample: boolean;
    lat: number;
    lng: number;
  } | null;
  conversationId: string;
  isGroup: boolean;
  groupName: string | null;
  /** Inclui quem organiza. */
  confirmedCount: number;
  invitedCount: number;
  declinedCount: number;
  /** CANCELLED: quem organizou cancelou. */
  status: 'ACTIVE' | 'CANCELLED';
  /** Você organiza e o encontro ainda pode mudar (não terminou nem foi cancelado). */
  canManage: boolean;
  /** Seu papel no encontro; nulo se você não participa (só acontece na leitura de quem não foi convidado). */
  myStatus: 'ORGANIZER' | 'INVITED' | 'CONFIRMED' | 'DECLINED' | null;
}

/** Monta o que o app mostra de cada encontro, do ponto de vista de `actorId`. */
export async function buildMeetupViews(deps: CoreDeps, actorId: string, records: MeetupRecord[]): Promise<MeetupView[]> {
  if (records.length === 0) return [];
  const { users, places, conversations } = deps;
  const now = deps.clock.now();
  const organizerIds = [...new Set(records.map((r) => r.organizerId))];
  const profiles = new Map((await users.findProfilesByIds(organizerIds)).map((p) => [p.userId, p] as const));
  const conversationCache = new Map<string, Awaited<ReturnType<typeof conversations.findById>>>();
  const out: MeetupView[] = [];
  for (const r of records) {
    const organizer = profiles.get(r.organizerId);
    if (!organizer) continue;
    if (!conversationCache.has(r.conversationId)) conversationCache.set(r.conversationId, await conversations.findById(r.conversationId));
    const conversation = conversationCache.get(r.conversationId);
    const found = r.eventId ? await places.findEvent(r.eventId) : undefined;
    const mine = r.participants.find((p) => p.userId === actorId);
    const count = (s: string) => r.participants.filter((p) => p.status === s).length;
    out.push({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      organizer: toPublicProfile(organizer),
      eventRef: r.eventPostId ?? r.eventId,
      event: found
        ? {
            id: found.event.id,
            venueId: found.venue.id,
            venueName: found.venue.name,
            address: found.venue.address,
            kind: found.event.kind,
            imageUrl: found.event.imageUrl,
            isFree: found.event.isFree,
            sample: found.event.isSample || found.venue.isSample,
            lat: found.venue.lat,
            lng: found.venue.lng,
          }
        : null,
      conversationId: r.conversationId,
      isGroup: conversation?.type === 'GROUP',
      groupName: conversation?.type === 'GROUP' ? conversation.name : null,
      confirmedCount: count('CONFIRMED'),
      invitedCount: count('INVITED'),
      declinedCount: count('DECLINED'),
      status: r.status,
      canManage: r.organizerId === actorId && r.status === 'ACTIVE' && r.endsAt > now,
      myStatus: r.organizerId === actorId ? 'ORGANIZER' : (mine?.status ?? null),
    });
  }
  return out;
}
