import type { ConversationItem, PublicProfile } from './types.ts';
import { t } from './i18n/index.ts';

/** Quem pode receber algo na folha de compartilhar: uma conversa que já existe ou um amigo sem conversa ainda. */
export interface ShareTarget {
  key: string;
  name: string;
  /** Nome mostrado embaixo (nome de exibição), para achar na busca. */
  subtitle: string;
  conversationId?: string;
  /** Amigo sem conversa: a conversa é aberta na hora de enviar. */
  userId?: string;
  profile?: PublicProfile;
  group?: { name: string; imageUrl: string | null };
}

/** Conversas recentes primeiro (na ordem da lista de conversas), depois amigos que ainda não têm conversa. */
export function shareTargets(conversations: readonly ConversationItem[], friends: readonly PublicProfile[]): ShareTarget[] {
  const out: ShareTarget[] = [];
  const withChat = new Set<string>();
  for (const c of conversations) {
    if (!c.canSend) continue;
    if (c.type === 'GROUP') {
      const name = c.name ?? t('Grupo');
      out.push({ key: `c:${c.id}`, name, subtitle: t('{n} pessoas', { n: c.memberCount }), conversationId: c.id, group: { name, imageUrl: c.imageUrl } });
    } else if (c.other) {
      withChat.add(c.other.userId);
      out.push({ key: `c:${c.id}`, name: c.other.username, subtitle: c.other.displayName, conversationId: c.id, profile: c.other });
    }
  }
  for (const f of friends) {
    if (withChat.has(f.userId)) continue;
    withChat.add(f.userId);
    out.push({ key: `u:${f.userId}`, name: f.username, subtitle: f.displayName, userId: f.userId, profile: f });
  }
  return out;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Busca por nome de usuário ou nome de exibição, sem diferenciar acento nem maiúscula. */
export function filterTargets(targets: readonly ShareTarget[], query: string): ShareTarget[] {
  const q = fold(query.replace(/^@/, ''));
  if (q === '') return [...targets];
  return targets.filter((target) => fold(target.name).includes(q) || fold(target.subtitle).includes(q));
}

/** Texto que vai na conversa quando o que se compartilha é um link. A mensagem opcional vem antes. */
export function chatLinkMessage(text: string, url: string, note?: string): string {
  const base = `${text}: ${url}`;
  const extra = note?.trim();
  return extra ? `${extra}\n\n${base}` : base;
}

export function whatsappLink(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
}

export function telegramLink(text: string, url: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
}

export function emailLink(subject: string, text: string, url: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${text}\n\n${url}`)}`;
}

/** Retorno depois de enviar: "Enviado para ana", "Enviado para ana e mais 2". */
export function sentText(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return t('Enviado para {name}.', { name: names[0]! });
  return t('Enviado para {name} e mais {n}.', { name: names[0]!, n: names.length - 1 });
}

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

interface ShareEnv {
  AskouTShare?: { share: (data: ShareData & { dialogTitle?: string }) => Promise<unknown> };
  navigator?: { share?: (data: ShareData) => Promise<void> };
}

/** Menu de compartilhar do aparelho: a ponte do app nativo (Capacitor) ou o navigator.share do navegador. */
export function nativeShareAvailable(env: ShareEnv = globalThis as never): boolean {
  return typeof env.AskouTShare?.share === 'function' || typeof env.navigator?.share === 'function';
}

/** Abre o menu do aparelho. Devolve false se a pessoa fechou sem compartilhar. */
export async function nativeShare(data: ShareData, env: ShareEnv = globalThis as never): Promise<boolean> {
  try {
    if (typeof env.AskouTShare?.share === 'function') await env.AskouTShare.share({ ...data, dialogTitle: t('Compartilhar') });
    else if (typeof env.navigator?.share === 'function') await env.navigator.share(data);
    else throw new Error('share-unavailable');
    return true;
  } catch (failure) {
    if (isCancel(failure)) return false;
    throw failure;
  }
}

function isCancel(failure: unknown): boolean {
  if (typeof DOMException !== 'undefined' && failure instanceof DOMException && failure.name === 'AbortError') return true;
  // O plugin do Capacitor rejeita com "Share canceled" quando a pessoa fecha o menu.
  return failure instanceof Error && (failure.name === 'AbortError' || /cancel/i.test(failure.message));
}
