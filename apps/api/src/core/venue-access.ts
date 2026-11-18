import type { PlaceRepository } from './ports.ts';
import type { VenueRecord } from './types.ts';

/** O que a pessoa é no local: dono (tudo), administrador adicional (só o dia a dia) ou ninguém. */
export type VenueRole = 'OWNER' | 'MANAGER' | null;

/** Dono, ou administrador adicional que já aceitou o convite. */
export async function venueRoleOf(places: Pick<PlaceRepository, 'findVenueManager'>, userId: string, venue: Pick<VenueRecord, 'id' | 'ownerId'>): Promise<VenueRole> {
  if (venue.ownerId === userId) return 'OWNER';
  const m = await places.findVenueManager(venue.id, userId);
  return m?.status === 'ACCEPTED' ? 'MANAGER' : null;
}

/** Quem pode cuidar do dia a dia do local (perfil, eventos, agenda, posts, chapelaria). Equipe e impulsionar ficam só com o dono. */
export async function canManageVenue(places: Pick<PlaceRepository, 'findVenueManager'>, userId: string, venue: Pick<VenueRecord, 'id' | 'ownerId'>): Promise<boolean> {
  return (await venueRoleOf(places, userId, venue)) !== null;
}

/** Ids dos locais que a pessoa administra, como dono ou como administradora adicional. */
export async function managedVenueIds(places: Pick<PlaceRepository, 'listVenuesByOwner' | 'listVenuesManagedBy'>, userId: string): Promise<string[]> {
  const [owned, managed] = await Promise.all([places.listVenuesByOwner(userId), places.listVenuesManagedBy(userId)]);
  return [...new Set([...owned, ...managed].map((v) => v.id))];
}
