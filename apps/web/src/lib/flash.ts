import { t } from '../lib/i18n/index.ts';
// Contas do Flash que não dependem de tela: distância, tempo restante e rótulos.

const EARTH_RADIUS_M = 6_371_000;

export interface Point {
  lat: number;
  lng: number;
}

const rad = (degrees: number) => (degrees * Math.PI) / 180;

/** Distância em metros entre dois pontos (fórmula de haversine). */
export function distanceMeters(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 80 -> "80 m"; 1240 -> "1,2 km"; 15000 -> "15 km". Arredonda para não fingir precisão que o GPS não tem. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 100) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  if (meters < 1000) return `${Math.round(meters / 50) * 50} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

/** Sempre em km, como na lista de amigos livres: 800 -> "0,8 km"; 2000 -> "2 km"; 2600 -> "2,6 km"; 15000 -> "15 km". */
export function formatKm(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  const km = meters / 1000;
  if (km >= 10) return `${Math.round(km)} km`;
  const text = (Math.max(0.1, Math.round(km * 10) / 10)).toFixed(1).replace('.', ',');
  return `${text.endsWith(',0') ? text.slice(0, -2) : text} km`;
}

/** Minutos restantes até `iso`: 0 quando já passou, arredondando para cima. */
export function minutesLeft(iso: string, nowMs: number): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - nowMs) / 60_000));
}

/** 5 -> "5 min"; 90 -> "1 h 30 min"; 120 -> "2 h". */
export function formatRemaining(minutes: number): string {
  if (minutes <= 0) return 'acabou';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "há 30 s", "há 3 min". Usa o relógio do servidor para não depender da hora do aparelho. */
export function formatAge(updatedAtIso: string, serverNowIso: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(serverNowIso) - Date.parse(updatedAtIso)) / 1000));
  if (Number.isNaN(seconds)) return '';
  if (seconds < 10) return 'agora';
  if (seconds < 60) return `há ${seconds} s`;
  return `há ${Math.floor(seconds / 60)} min`;
}

/** Avisa o resto do app (o raio do topo, por exemplo) que o Flash ligou, desligou ou mudou de estado. */
/** Mensagem de sistema que a API posta ao casar um Flash (mesmo texto de `FLASH_MATCH_MESSAGE` na API). */
export const FLASH_MATCH_MESSAGE = t('Flash combinado! Vocês dois estão disponíveis agora.');
export const FLASH_CHANGED_EVENT = 'askout:flash-changed';
export function announceFlashChange(): void {
  window.dispatchEvent(new Event(FLASH_CHANGED_EVENT));
}

export const FLASH_DURATIONS: readonly number[] = [1, 2, 3];
export const FLASH_MIN_MINUTES = 5;
export const FLASH_MAX_MINUTES = 180;
export const FLASH_DEFAULT_MINUTES = 120;

/** Mantém a duração dentro do que a API aceita (5 min a 3 h, de 5 em 5). */
export function clampFlashMinutes(minutes: number): number {
  const rounded = Math.round(minutes / 5) * 5;
  return Math.min(FLASH_MAX_MINUTES, Math.max(FLASH_MIN_MINUTES, rounded));
}

/** "1 h 30 min", "45 min", "2 h". */
export function formatFlashDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
export const FLASH_NOTE_MAX = 60;

export function flashNoteProblem(note: string): string | undefined {
  return Array.from(note.trim()).length > FLASH_NOTE_MAX ? t('Use no máximo {FLASH_NOTE_MAX} caracteres', { FLASH_NOTE_MAX }) : undefined;
}

/** Mensagem para cada motivo de falha do navegador ao pegar a localização (códigos de GeolocationPositionError). */
export function geolocationMessage(code: number | undefined, secure: boolean): string {
  if (!secure) return t('O navegador só libera a localização em conexão segura (https).');
  if (code === 1) return t('A localização está bloqueada. Libere nas configurações do navegador ou do celular para compartilhar.');
  if (code === 2) return t('Não foi possível descobrir onde você está agora. Vá para um lugar com melhor sinal.');
  if (code === 3) return t('A localização demorou demais. Toque em compartilhar para tentar de novo.');
  return t('Este aparelho não consegue informar a localização.');
}

/** Contagem regressiva: "1h 58min" (de uma hora para cima) ou "42min 07s". */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'acabou';
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${two(m)}min` : `${m}min ${two(sec)}s`;
}

/** Quanto do tempo do Flash ainda resta, de 0 a 1. */
export function flashRemainingShare(startsAt: string | null, expiresAt: string, nowMs: number): number {
  const end = Date.parse(expiresAt);
  const start = startsAt ? Date.parse(startsAt) : Number.NaN;
  if (Number.isNaN(end) || Number.isNaN(start) || end <= start) return 0;
  return Math.min(1, Math.max(0, (end - nowMs) / (end - start)));
}
