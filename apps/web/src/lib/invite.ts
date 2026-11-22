import { t } from '../lib/i18n/index.ts';
const USERNAME = /^[a-z0-9._]{3,30}$/;
const KEY = 'askout.invite';

/** AskouT nas lojas. */
export const APP_STORE_URL = 'https://apps.apple.com/br/app/askout/id6826608065';
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=br.com.askout';

/**
 * Link de convite: `/convite/usuario`. Com o app instalado, o celular abre o app direto (Universal Link no iPhone;
 * no Android a página chama o app). Sem o app, a página manda para a loja; no computador, para o cadastro do site.
 */
export function inviteUrl(origin: string, username: string): string {
  return `${origin}/convite/${encodeURIComponent(username)}`;
}

export type InvitePlatform = 'ios' | 'android' | 'other';

/** Sistema do celular pelo navegador. iPad em "modo computador" se diz Macintosh, mas tem toque. */
export function invitePlatform(userAgent: string, maxTouchPoints = 0): InvitePlatform {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent) || (/macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'ios';
  return 'other';
}

/**
 * Para onde vai quem abriu o convite:
 * - dentro do app: o perfil de quem convidou (logado) ou o cadastro com o convite;
 * - celular sem o app: a loja (no Android, pelo `intent://`, que abre o app se estiver instalado e senão cai no Play);
 * - computador: o cadastro do site.
 */
export function inviteLandingTarget(o: { username: string; native: boolean; loggedIn: boolean; platform: InvitePlatform }): { kind: 'route' | 'external'; to: string } {
  const u = encodeURIComponent(o.username);
  if (o.native && o.loggedIn) return { kind: 'route', to: `/u/${u}` };
  if (o.native || o.platform === 'other') return { kind: 'route', to: `/cadastro?convite=${u}` };
  if (o.platform === 'ios') return { kind: 'external', to: APP_STORE_URL };
  return {
    kind: 'external',
    to: `intent://convite/${u}#Intent;scheme=br.com.askout;package=br.com.askout;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`,
  };
}

export function inviteText(displayName: string): string {
  return t('{displayName} te chamou para o AskouT, a rede social de rolês. Entra aí:', { displayName });
}

/** Abre o WhatsApp com a mensagem pronta (o app ou o WhatsApp Web, conforme o aparelho). */
export function whatsappUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

/** Lê e confere o usuário do parâmetro `convite`; qualquer coisa fora do padrão de usuário é ignorada. */
export function parseInvite(value: string | null | undefined): string | undefined {
  const name = (value ?? '').trim().toLowerCase().replace(/^@/, '');
  return USERNAME.test(name) ? name : undefined;
}

export function rememberInvite(storage: Pick<Storage, 'setItem'> | undefined, username: string): void {
  try {
    storage?.setItem(KEY, username);
  } catch {
    // sem armazenamento: o convite só não é lembrado entre telas
  }
}

/** Devolve o convite guardado e apaga, para valer uma vez só. */
export function takeInvite(storage: Pick<Storage, 'getItem' | 'removeItem'> | undefined): string | undefined {
  try {
    const found = parseInvite(storage?.getItem(KEY));
    storage?.removeItem(KEY);
    return found;
  } catch {
    return undefined;
  }
}
