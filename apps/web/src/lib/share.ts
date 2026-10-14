/** Link público do evento, para mandar fora do app. */
export function eventLink(origin: string, eventId: string): string {
  return `${origin}/eventos/${encodeURIComponent(eventId)}`;
}

/** Link do post, para mandar fora do app ou numa conversa. */
export function postLink(origin: string, postId: string): string {
  return `${origin}/posts/${encodeURIComponent(postId)}`;
}

export function postShareText(authorName: string): string {
  return `Olha esse post de ${authorName} no AskouT`;
}

export function eventShareText(title: string): string {
  return `Olha esse evento no AskouT: ${title}`;
}
