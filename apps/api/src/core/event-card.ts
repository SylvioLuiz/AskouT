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
  startsAt: string;
  endsAt: string;
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
}

export async function buildEventCards(deps: CoreDeps, ids: string[]): Promise<Map<string, EventCardView>> {
  const out = new Map<string, EventCardView>();
  for (const id of [...new Set(ids)]) {
    const found = await deps.places.findEvent(id);
    if (!found) continue;
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
