/**
 * Modo visitante (sem login): a cidade escolhida à mão faz o papel da posição. O app não pede a localização do aparelho
 * para quem não entrou; só usa se a pessoa tocar em "Usar minha localização". Sem cidade escolhida, nada é carregado.
 */
import type { Position } from './position.ts';

export interface VisitorCity {
  id: string;
  name: string;
  position: Position;
}

export const VISITOR_CITIES: readonly VisitorCity[] = [
  { id: 'sao-paulo', name: 'São Paulo', position: { lat: -23.5505, lng: -46.6333 } },
  { id: 'santos', name: 'Santos', position: { lat: -23.9608, lng: -46.3336 } },
  { id: 'mogi', name: 'Mogi das Cruzes', position: { lat: -23.5229, lng: -46.1883 } },
  { id: 'guaruja', name: 'Guarujá', position: { lat: -23.9931, lng: -46.2564 } },
  { id: 'praia-grande', name: 'Praia Grande', position: { lat: -24.0058, lng: -46.4028 } },
  { id: 'campinas', name: 'Campinas', position: { lat: -22.9099, lng: -47.0626 } },
  { id: 'sjc', name: 'São José dos Campos', position: { lat: -23.1896, lng: -45.8841 } },
  { id: 'rio', name: 'Rio de Janeiro', position: { lat: -22.9068, lng: -43.1729 } },
  { id: 'bh', name: 'Belo Horizonte', position: { lat: -19.9167, lng: -43.9345 } },
  { id: 'curitiba', name: 'Curitiba', position: { lat: -25.4284, lng: -49.2733 } },
];

/** Id usado quando a pessoa escolheu a própria localização (só fica guardada neste aparelho). */
export const HERE_ID = 'aqui';
const KEY = 'askout.visitor.city';
export const VISITOR_CITY_EVENT = 'askout:visitor-city';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function valid(p: unknown): p is Position {
  if (typeof p !== 'object' || p === null) return false;
  const { lat, lng } = p as Record<string, unknown>;
  return typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** A cidade escolhida à mão, ou undefined enquanto não escolheu (aí o app não mostra nada, só pede a cidade ou o login). */
export function readVisitorCity(storage: StorageLike | undefined): VisitorCity | undefined {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(KEY) ?? null;
  } catch {
    raw = null;
  }
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { id?: unknown; position?: unknown };
      const known = VISITOR_CITIES.find((c) => c.id === parsed.id);
      if (known) return known;
      if (parsed.id === HERE_ID && valid(parsed.position)) return { id: HERE_ID, name: 'Perto de você', position: parsed.position };
    } catch {
      // guardado com defeito: volta ao padrão
    }
  }
  return undefined;
}

export function saveVisitorCity(storage: StorageLike | undefined, city: { id: string; position: Position }): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ id: city.id, position: city.position }));
  } catch {
    // sem armazenamento: vale só até fechar
  }
}

const RETURN_KEY = 'askout.login-return';
/** Só telas que o visitante vê voltam depois do login (nada de endereço de fora). */
const RETURN_PATH = /^\/(eventos\/[^/?#]+|bares\/[^/?#]+)(\?[^#]*)?$/;

/** Tocou numa ação que pede conta: depois de entrar, volta para onde estava. */
export function rememberLoginReturn(storage: Pick<Storage, 'setItem'> | undefined, path: string): void {
  if (!RETURN_PATH.test(path)) return;
  try {
    storage?.setItem(RETURN_KEY, path);
  } catch {
    // sem armazenamento: só não volta sozinho
  }
}

export function takeLoginReturn(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined): string | undefined {
  try {
    const path = storage?.getItem(RETURN_KEY) ?? undefined;
    storage?.removeItem(RETURN_KEY);
    return path && RETURN_PATH.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}
