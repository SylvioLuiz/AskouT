import { t } from '../lib/i18n/index.ts';
const USERNAME = /^[a-z0-9._]{3,30}$/;
const KEY = 'askout.invite';

/** Link de convite: abre o cadastro já sabendo quem convidou. */
export function inviteUrl(origin: string, username: string): string {
  return `${origin}/cadastro?convite=${encodeURIComponent(username)}`;
}

/** Quantos amigos a pessoa precisa ter para o card "Chame a galera" sair da Home. */
export const INVITE_CARD_GOAL = 5;

/**
 * O card "Chame a galera" aparece na Home enquanto a pessoa tem menos de 5 amigos.
 * Enquanto a lista não chegou, não mostra (evita piscar e sumir); se a lista falhar, também não mostra.
 */
export function showInviteCard(friendCount: number | undefined): boolean {
  return friendCount !== undefined && friendCount < INVITE_CARD_GOAL;
}

/**
 * Endereço de loja configurado (VITE_STORE_URL), só se for http(s). Vazio enquanto o app não está nas lojas.
 * Quando existir, é ele que vai no convite, no lugar do link do site.
 */
export function storeLink(value: string | undefined): string | undefined {
  const v = (value ?? '').trim();
  return /^https?:\/\/[^\s]+$/i.test(v) ? v : undefined;
}

/** O que o convite compartilha: o link da loja, se houver; senão o link do site que já registra quem convidou. */
export function shareableInviteUrl(origin: string, username: string, store: string | undefined): string {
  return store ?? inviteUrl(origin, username);
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
