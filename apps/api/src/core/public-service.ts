import type { EventPageService, EventPageView } from './event-page-service.ts';
import type { ExploreInput, ExplorePlaceItem, ExploreService, ExploreView } from './explore-service.ts';
import type { VenueProfileView, VenueService } from './venue-service.ts';
import { VISITOR_ID } from './visitor.ts';

/** Local na lista do visitante: ninguém segue (não há conta). */
function anonymousPlace(p: ExplorePlaceItem): ExplorePlaceItem {
  return p.venue ? { ...p, venue: { ...p.venue, following: false } } : p;
}

/**
 * Leituras para quem não entrou (modo visitante): Explorar, mapa, página do evento e página do local.
 * Nada de pessoas: sem perfis na busca, sem eventos criados por pessoas no Explorar, sem quem vai, sem frequentadores nem amigos.
 * A página de um evento criado por uma pessoa abre só se ele for público e o perfil de quem criou também (ver EventPageService.publicGet).
 * A posição enviada vale só para a consulta (a cidade escolhida à mão), nada é guardado.
 */
export class PublicService {
  private readonly explore: ExploreService;
  private readonly eventPages: EventPageService;
  private readonly venues: VenueService;

  constructor(explore: ExploreService, eventPages: EventPageService, venues: VenueService) {
    this.explore = explore;
    this.eventPages = eventPages;
    this.venues = venues;
  }

  async search(input: ExploreInput): Promise<ExploreView> {
    const view = await this.explore.search(VISITOR_ID, input, { withPeople: false });
    return { ...view, events: view.events.filter((e) => !e.author), people: [], places: view.places.map(anonymousPlace) };
  }

  async mapPlaces(input: ExploreInput): Promise<{ places: ExplorePlaceItem[]; placesAvailable: boolean }> {
    const view = await this.explore.mapPlaces(VISITOR_ID, input);
    return { ...view, places: view.places.map(anonymousPlace) };
  }

  event(id: unknown, input: { lat?: number; lng?: number } = {}): Promise<EventPageView> {
    return this.eventPages.publicGet(id, input);
  }

  async venue(id: unknown): Promise<VenueProfileView> {
    const view = await this.venues.profile(VISITOR_ID, id, { withVisitors: false });
    return { ...view, isOwner: false, canManage: false, role: null, following: false, notify: false, rating: { ...view.rating, mine: null } };
  }
}
