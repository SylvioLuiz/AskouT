/**
 * Chegada no NOW com o celular bloqueado: quando a pessoa mostra a chegada, o app do celular (ponte
 * `window.AskouTBackgroundLocation`, ver apps/mobile) continua mandando a posição em segundo plano.
 * No navegador a ponte não existe e o envio segue só com a tela aberta.
 */

import { distanceMeters } from './flash.ts';

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
  /** Barra de progresso no aviso fixo (só Android com o plugin do app; pode faltar em versões antigas). */
  progress?(update: { title: string; text: string; progress: number; arrived: boolean }): Promise<void>;
}

export function backgroundLocationBridge(host: unknown = typeof window === 'undefined' ? undefined : window): BackgroundLocationBridge | undefined {
  const b = (host as { AskouTBackgroundLocation?: Partial<BackgroundLocationBridge> } | undefined)?.AskouTBackgroundLocation;
  return b && typeof b.start === 'function' && typeof b.put === 'function' ? (b as BackgroundLocationBridge) : undefined;
}

/** A esta distância (ou menos) do alvo conta como chegada (o mesmo do servidor, apps/api core/arrival.ts). */
export const OWN_ARRIVED_M = 80;

export interface OwnArrivalStep {
  /** Distância de quando começou a mostrar (ou a maior já vista): é o 0 da barra. */
  startM: number;
  distanceM: number;
  minutes: number;
  /** 0–100. */
  progress: number;
  arrived: boolean;
}

/**
 * Quanto falta para quem está mostrando a chegada, para o aviso fixo do próprio celular. Mesmas contas que o servidor
 * faz para o aviso do amigo (linha reta × 1,3; a pé até 2 km, de carro acima), para os dois verem o mesmo.
 */
export function ownArrivalStep(startM: number | undefined, from: { lat: number; lng: number }, to: { lat: number; lng: number }): OwnArrivalStep {
  const distanceM = Math.round(distanceMeters(from, to));
  const start = Math.max(startM ?? 0, distanceM, OWN_ARRIVED_M);
  const arrived = distanceM <= OWN_ARRIVED_M;
  const path = distanceM * 1.3;
  const minutes = arrived ? 0 : Math.max(1, Math.ceil(path / (distanceM <= 2000 ? 80 : 417)));
  const ratio = arrived || start <= OWN_ARRIVED_M ? 1 : 1 - (distanceM - OWN_ARRIVED_M) / (start - OWN_ARRIVED_M);
  return { startM: start, distanceM, minutes, progress: Math.round(Math.min(1, Math.max(0, ratio)) * 100), arrived };
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
