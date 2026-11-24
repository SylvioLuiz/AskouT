import { canOpenByInvite } from './event-invites.ts';
import type { CoreDeps } from './ports.ts';
import type { EventKind } from './types.ts';

/** Resumo de um evento para cartões (conversa, grade do perfil). */
export interface EventCardView {
  id: string;
  title: string;
  kind: EventKind;
  isFree: boolean;
  imageUrl: string | null;
  venueId: string;
  venueName: string;
  /** Nulo em evento de pessoa cuja data ainda vai ser decidida numa votação. */
  startsAt: string | null;
  endsAt: string | null;
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
  /** Evento criado por uma pessoa (id do post): `venueId` vem vazio e `venueName` é o lugar que ela escolheu. */
  userEvent?: boolean;
  /** Dono do evento criado por uma pessoa. */
  ownerId?: string;
  /** Evento privado criado por uma pessoa. */
  private?: boolean;
  /**
   * Só nas abas Eventos e Participou do perfil: de onde o evento veio para a dona do perfil.
   * CREATED: ela criou; INVITED: foi convidada (marcada, recebeu o cartão numa conversa ou é evento privado); PUBLIC: evento aberto.
   */
  origin?: EventOrigin;
  /** Só nos cartões da conversa: quem está vendo já confirmou presença (ou é o dono do evento). */
  going?: boolean;
}

export type EventOrigin = 'CREATED' | 'INVITED' | 'PUBLIC';

/** De onde o evento veio para `userId`: criou, foi convidada ou é um evento público em que entrou por conta própria. */
export async function eventOrigin(deps: Pick<CoreDeps, 'posts' | 'conversations'>, userId: string, card: EventCardView): Promise<EventOrigin> {
  if (card.ownerId === userId) return 'CREATED';
  if (!card.userEvent) return 'PUBLIC';
  // Evento privado só abre com convite; no público, vale o convite registrado (marcação ou cartão enviado numa conversa).
  if (card.private || (await canOpenByInvite(deps, userId, card.id))) return 'INVITED';
  return 'PUBLIC';
}

export async function buildEventCards(deps: CoreDeps, ids: string[]): Promise<Map<string, EventCardView>> {
  const out = new Map<string, EventCardView>();
  // Busca em paralelo; o preenchimento do mapa segue a ordem original.
  const unique = [...new Set(ids)];
  const looked = await Promise.all(
    unique.map(async (id) => {
      const found = await deps.places.findEvent(id);
      return { id, found, post: found ? undefined : await deps.posts.findById(id) };
    }),
  );
  for (const { id, found, post } of looked) {
    if (!found) {
      const p = post?.post;
      if (!p || !p.eventTitle || p.archivedAt) continue;
      // Capa: a primeira foto enviada (a rota da imagem é pública, o id é aleatório). Foto do Google fica de fora.
      const first = [...(post?.images ?? [])].sort((a, b) => a.position - b.position)[0];
      const cover = first?.isUpload ? `/posts/images/${first.id}` : null;
      out.set(id, { id: p.id, title: p.eventTitle, kind: p.eventKind, isFree: false, imageUrl: cover, venueId: '', venueName: p.placeName ?? '', startsAt: p.eventStartsAt ? p.eventStartsAt.toISOString() : null, endsAt: p.eventEndsAt ? p.eventEndsAt.toISOString() : null, sample: false, userEvent: true, ownerId: p.authorId, private: p.eventPrivate === true });
      continue;
    }
    const { event, venue } = found;
    out.set(id, {
      id: event.id,
      title: event.title,
      kind: event.kind,
      isFree: event.isFree,
      imageUrl: event.imageUrl,
      venueId: venue.id,
      venueName: venue.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      sample: event.isSample,
    });
  }
  return out;
}
