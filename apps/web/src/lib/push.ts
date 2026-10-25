import { t } from '../lib/i18n/index.ts';
import type { Api } from './api.ts';

export type PushState =
  | 'unsupported' // o navegador não tem Web Push
  | 'needs-install' // iPhone/iPad: só funciona com o app na Tela de Início
  | 'not-configured' // o servidor não tem chaves de push
  | 'denied' // a pessoa bloqueou os avisos no navegador
  | 'off' // pode ligar
  | 'on'; // ligado neste aparelho

export interface PushEnvironment {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  secureContext: boolean;
  permission: 'default' | 'granted' | 'denied';
  isApple: boolean;
  standalone: boolean;
  /** Chave pública do servidor; `null` quando não configurada; `undefined` enquanto não consultou. */
  serverKey: string | null | undefined;
  subscribed: boolean;
}

/** Decide o que mostrar. Função pura para dar para testar sem navegador. */
export function pushState(env: PushEnvironment): PushState {
  if (env.isApple && !env.standalone) return 'needs-install';
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification || !env.secureContext) return 'unsupported';
  if (env.serverKey === null) return 'not-configured';
  if (env.permission === 'denied') return 'denied';
  return env.subscribed && env.permission === 'granted' ? 'on' : 'off';
}

export function urlBase64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Formato que a API espera, a partir do JSON da inscrição do navegador. */
export function subscriptionBody(json: { endpoint?: string; keys?: Record<string, string> }): { endpoint: string; keys: { p256dh: string; auth: string } } {
  const { endpoint, keys } = json;
  if (!endpoint || !keys?.['p256dh'] || !keys['auth']) throw new Error(t('O navegador devolveu uma inscrição incompleta'));
  return { endpoint, keys: { p256dh: keys['p256dh'], auth: keys['auth'] } };
}

export function readEnvironment(serverKey: string | null | undefined, subscribed: boolean): PushEnvironment {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const apple = /iPhone|iPad|iPod/.test(ua) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true);
  return {
    hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    hasNotification: typeof Notification !== 'undefined',
    secureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    permission: typeof Notification === 'undefined' ? 'denied' : Notification.permission,
    isApple: apple,
    standalone,
    serverKey,
    subscribed,
  };
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js');
  return navigator.serviceWorker.ready;
}

/** Está inscrito neste navegador? (não pede nada à pessoa) */
export async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    if (!('serviceWorker' in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration('/sw.js');
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** Pede permissão, inscreve o navegador e registra na API. Lança Error com texto claro. */
export async function enablePush(api: Api, publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(t('Os avisos não foram liberados no navegador.'));
  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  const subscription = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(publicKey) }));
  await api.pushSubscribe(subscriptionBody(subscription.toJSON()));
}

export async function disablePush(api: Api): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await api.pushUnsubscribe(endpoint);
  await subscription.unsubscribe();
}

// ——— App no iPhone (ponte `window.AskouTPush`, ver apps/mobile) ———

export interface NativePushBridge {
  permission(): Promise<'granted' | 'denied' | 'prompt'>;
  /** Pede permissão se preciso e devolve o token do aparelho; `undefined` se a pessoa recusou. */
  register(): Promise<string | undefined>;
}

export function nativePushBridge(host: unknown = typeof window === 'undefined' ? undefined : window): NativePushBridge | undefined {
  const b = (host as { AskouTPush?: Partial<NativePushBridge> } | undefined)?.AskouTPush;
  return b && typeof b.permission === 'function' && typeof b.register === 'function' ? (b as NativePushBridge) : undefined;
}

const NATIVE_TOKEN_KEY = 'askout.push.native-token';
export const nativeEndpoint = (token: string): string => `apns:${token}`;

function storedNativeToken(): string | null {
  try {
    return localStorage.getItem(NATIVE_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeNativeToken(token: string | null): void {
  try {
    if (token === null) localStorage.removeItem(NATIVE_TOKEN_KEY);
    else localStorage.setItem(NATIVE_TOKEN_KEY, token);
  } catch {
    /* sem armazenamento: o botão só mostra "ligar" de novo */
  }
}

/** Estado do botão no app do iPhone. Função pura. */
export function nativePushState(input: { serverNative: boolean; permission: 'granted' | 'denied' | 'prompt'; hasToken: boolean }): PushState {
  if (!input.serverNative) return 'not-configured';
  if (input.permission === 'denied') return 'denied';
  return input.permission === 'granted' && input.hasToken ? 'on' : 'off';
}

export async function readNativeState(bridge: NativePushBridge, serverNative: boolean): Promise<PushState> {
  let permission: 'granted' | 'denied' | 'prompt' = 'prompt';
  try {
    permission = await bridge.permission();
  } catch {
    /* trata como "ainda não pediu" */
  }
  return nativePushState({ serverNative, permission, hasToken: storedNativeToken() !== null });
}

export async function enableNativePush(api: Api, bridge: NativePushBridge): Promise<void> {
  const token = await bridge.register();
  if (!token) throw new Error(t('Os avisos não foram liberados. Você pode liberar em Ajustes do iPhone > AskouT > Notificações.'));
  await api.pushSubscribe({ endpoint: nativeEndpoint(token) });
  storeNativeToken(token);
}

export async function disableNativePush(api: Api): Promise<void> {
  const token = storedNativeToken();
  if (token) await api.pushUnsubscribe(nativeEndpoint(token));
  storeNativeToken(null);
}

/** O iPhone pode trocar o token do aparelho; ao abrir, quem já ligou registra de novo em silêncio. */
export async function refreshNativeToken(api: Api, bridge: NativePushBridge): Promise<void> {
  const old = storedNativeToken();
  if (!old || (await bridge.permission()) !== 'granted') return;
  const token = await bridge.register();
  if (!token) return;
  await api.pushSubscribe({ endpoint: nativeEndpoint(token) });
  if (token !== old) await api.pushUnsubscribe(nativeEndpoint(old)).catch(() => undefined);
  storeNativeToken(token);
}
