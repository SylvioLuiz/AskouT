/**
 * Chegada no NOW com o celular bloqueado: quando a pessoa mostra a chegada, o app do celular (ponte
 * `window.AskouTBackgroundLocation`, ver apps/mobile) continua mandando a posição em segundo plano.
 * No navegador a ponte não existe e o envio segue só com a tela aberta.
 */

export interface BackgroundFix {
  lat: number;
  lng: number;
  accuracyM: number;
  time: number;
}

export interface BackgroundLocationBridge {
  start(options: { title: string; message: string; onFix: (fix: BackgroundFix) => void; onError?: (code: string) => void }): Promise<() => Promise<void>>;
  put(url: string, headers: Record<string, string>, body: unknown): Promise<number>;
  openSettings(): Promise<void>;
}

export function backgroundLocationBridge(host: unknown = typeof window === 'undefined' ? undefined : window): BackgroundLocationBridge | undefined {
  const b = (host as { AskouTBackgroundLocation?: Partial<BackgroundLocationBridge> } | undefined)?.AskouTBackgroundLocation;
  return b && typeof b.start === 'function' && typeof b.put === 'function' ? (b as BackgroundLocationBridge) : undefined;
}

/** Intervalo mínimo entre dois envios em segundo plano (o servidor só atualiza o aviso a cada 45 s). */
export const BACKGROUND_SEND_EVERY_MS = 20_000;

/**
 * Decide se manda esta posição: respeita o intervalo, mas manda logo se a pessoa andou bastante (≥ 150 m),
 * para a chegada não atrasar.
 */
export function shouldSendFix(last: { at: number; lat: number; lng: number } | undefined, fix: BackgroundFix, nowMs: number): boolean {
  if (!last) return true;
  if (nowMs - last.at >= BACKGROUND_SEND_EVERY_MS) return true;
  const dLat = (fix.lat - last.lat) * 111_000;
  const dLng = (fix.lng - last.lng) * 111_000 * Math.cos((fix.lat * Math.PI) / 180);
  return nowMs - last.at >= 5_000 && Math.hypot(dLat, dLng) >= 150;
}
