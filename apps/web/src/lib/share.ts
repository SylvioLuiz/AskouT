import { t } from '../lib/i18n/index.ts';
/** Link público do evento, para mandar fora do app. */
export function eventLink(origin: string, eventId: string): string {
  return `${origin}/eventos/${encodeURIComponent(eventId)}`;
}

/** Link do post, para mandar fora do app ou numa conversa. */
export function postLink(origin: string, postId: string): string {
  return `${origin}/posts/${encodeURIComponent(postId)}`;
}

export function postShareText(authorName: string): string {
  return t('Olha esse post de {authorName} no AskouT', { authorName });
}

export function eventShareText(title: string): string {
  return t('Olha esse evento no AskouT: {title}', { title });
}

/** Link do perfil, para mandar fora do app ou numa conversa. */
export function profileLink(origin: string, username: string): string {
  return `${origin}/u/${encodeURIComponent(username)}`;
}

export function profileShareText(username: string): string {
  return t('Olha o perfil de @{username} no AskouT', { username });
}
