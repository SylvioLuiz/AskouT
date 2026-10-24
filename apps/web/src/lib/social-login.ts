import type { SocialProviderId } from './types.ts';

/** Carrega o script da plataforma uma única vez. */
const loading = new Map<string, Promise<void>>();
export function loadScript(src: string): Promise<void> {
  const known = loading.get(src);
  if (known) return known;
  const promise = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      loading.delete(src);
      reject(new Error('Não foi possível carregar o login da plataforma. Verifique sua conexão.'));
    };
    document.head.appendChild(el);
  });
  loading.set(src, promise);
  return promise;
}

export const GOOGLE_SCRIPT = 'https://accounts.google.com/gsi/client';
export const APPLE_SCRIPT = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/pt_BR/appleid.auth.js';

interface GoogleId {
  initialize(config: { client_id: string; callback: (response: { credential?: string }) => void; ux_mode?: 'popup' }): void;
  renderButton(element: HTMLElement, options: Record<string, unknown>): void;
}
interface AppleAuth {
  init(config: { clientId: string; scope: string; redirectURI: string; usePopup: boolean }): void;
  signIn(): Promise<{ authorization?: { id_token?: string } }>;
}

export function googleApi(): GoogleId | undefined {
  return (window as unknown as { google?: { accounts?: { id?: GoogleId } } }).google?.accounts?.id;
}

/** Ponte do app para iPhone (`window.AskouTApple`, ver apps/mobile): abre a janela nativa da Apple. */
export interface NativeAppleBridge {
  signIn(): Promise<string | undefined>;
}

export function nativeAppleBridge(host: unknown = globalThis): NativeAppleBridge | undefined {
  const b = (host as { AskouTApple?: Partial<NativeAppleBridge> } | undefined)?.AskouTApple;
  return b && typeof b.signIn === 'function' ? (b as NativeAppleBridge) : undefined;
}

/** Abre a janela da Apple (a nativa dentro do app do iPhone, a do site no navegador) e devolve o token de identidade. Recusar ou fechar a janela devolve undefined. */
export async function appleIdToken(clientId: string): Promise<string | undefined> {
  const native = nativeAppleBridge();
  if (native) return native.signIn();
  await loadScript(APPLE_SCRIPT);
  const apple = (window as unknown as { AppleID?: { auth?: AppleAuth } }).AppleID?.auth;
  if (!apple) throw new Error('Não foi possível carregar o login da Apple.');
  apple.init({ clientId, scope: 'name email', redirectURI: window.location.origin, usePopup: true });
  try {
    const result = await apple.signIn();
    return result.authorization?.id_token;
  } catch {
    return undefined; // a pessoa fechou a janela
  }
}

export function providerLabel(provider: SocialProviderId): string {
  return provider === 'GOOGLE' ? 'Google' : 'Apple';
}
