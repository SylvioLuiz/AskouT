/** Pacote do app Android (o mesmo do `applicationId` em apps/mobile/android/app/build.gradle). */
export const ANDROID_PACKAGE = 'br.com.askout';
export const PLAY_STORE_DEFAULT = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;
export const APP_STORE_DEFAULT = 'https://apps.apple.com/br/app/askout/id6826608065';

export interface StoreLinks {
  apple?: string;
  google?: string;
}

function httpUrl(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  return /^https:\/\/[^\s]+$/i.test(v) ? v : undefined;
}

/**
 * Links das lojas mostrados no rodapé da entrada quando o app é aberto no navegador.
 * App Store: `VITE_APP_STORE_URL`, ou a página do AskouT na App Store.
 * Google Play: `VITE_PLAY_STORE_URL`, ou o endereço padrão do pacote br.com.askout.
 * Em qualquer um, `"off"` esconde o selo; endereço que não seja https também.
 */
export function storeLinks(env: { apple?: string | undefined; google?: string | undefined }): StoreLinks {
  const links: StoreLinks = {};
  const apple = pick(env.apple, APP_STORE_DEFAULT);
  if (apple) links.apple = apple;
  const google = pick(env.google, PLAY_STORE_DEFAULT);
  if (google) links.google = google;
  return links;
}

function pick(value: string | undefined, fallback: string): string | undefined {
  const v = (value ?? '').trim();
  if (v.toLowerCase() === 'off') return undefined;
  return v === '' ? fallback : httpUrl(v);
}

/** Dentro do app (Capacitor) não faz sentido mandar a pessoa para a loja. */
export function isNativeApp(): boolean {
  try {
    return Boolean((globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}
