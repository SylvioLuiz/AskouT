// Contas geográficas simples. Para distâncias de cidade (dezenas de km) o ponto médio por média de
// coordenadas é suficiente; não usar isto para distâncias continentais.

const EARTH_RADIUS_M = 6_371_000;
const rad = (degrees: number) => (degrees * Math.PI) / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Distância em metros entre dois pontos (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function midpoint(a: LatLng, b: LatLng): LatLng {
  return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
}

/** Caixa (em graus) que contém todo círculo de `radiusM` em volta de `center`. Serve para pré-filtrar no banco. */
export function boundingBox(center: LatLng, radiusM: number): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const cos = Math.max(0.01, Math.cos(rad(center.lat)));
  const dLng = dLat / cos;
  return { minLat: center.lat - dLat, maxLat: center.lat + dLat, minLng: center.lng - dLng, maxLng: center.lng + dLng };
}
