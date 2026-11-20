/**
 * Posição do aparelho, uma só para o app inteiro. O app pede logo depois do login (Home), e Explorar, mapa, evento e
 * "Para você" reaproveitam a mesma resposta em vez de perguntar de novo. Fica só na memória desta sessão da página.
 */
export type Position = { lat: number; lng: number };
export type PositionResult = { status: 'ok'; position: Position } | { status: 'denied' | 'unavailable' };

export const POSITION_MAX_AGE_MS = 5 * 60_000;
const TIMEOUT_MS = 10_000;

let last: { position: Position; at: number } | undefined;
let refused: 'denied' | 'unavailable' | undefined;
let inflight: Promise<PositionResult> | undefined;

/** A última posição, se ainda for recente. */
export function cachedPosition(now = Date.now()): Position | undefined {
  return last && now - last.at < POSITION_MAX_AGE_MS ? last.position : undefined;
}

/** Guarda uma posição vinda de outro lugar do app (mantém o cache único). */
export function rememberPosition(position: Position, now = Date.now()): void {
  last = { position, at: now };
  refused = undefined;
}

/**
 * Pede a posição ao aparelho (a primeira chamada faz o navegador perguntar; as seguintes reaproveitam a resposta ou
 * a negativa). Nunca rejeita: devolve `denied` ou `unavailable`.
 */
export function requestPosition(): Promise<PositionResult> {
  const cached = cachedPosition();
  if (cached) return Promise.resolve({ status: 'ok', position: cached });
  if (refused === 'denied') return Promise.resolve({ status: 'denied' });
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve({ status: 'unavailable' });
  inflight ??= new Promise<PositionResult>((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const position = { lat: p.coords.latitude, lng: p.coords.longitude };
        rememberPosition(position);
        resolve({ status: 'ok', position });
      },
      (err) => {
        // Só a negativa da pessoa vale para a sessão toda; falha de sinal pode dar certo na próxima.
        if (err.code === 1) refused = 'denied';
        resolve({ status: err.code === 1 ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: POSITION_MAX_AGE_MS },
    );
  }).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/** Espera a posição por até `ms`; passou disso (ou sem permissão), segue sem ela. Quem chama não trava esperando a pessoa decidir. */
export async function positionWithin(ms: number): Promise<Position | undefined> {
  const cached = cachedPosition();
  if (cached) return cached;
  const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms));
  const result = await Promise.race([requestPosition(), timeout]);
  return result?.status === 'ok' ? result.position : undefined;
}

/** Só para teste: volta ao estado inicial. */
export function resetPositionForTests(): void {
  last = undefined;
  refused = undefined;
  inflight = undefined;
}
