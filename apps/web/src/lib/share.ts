/** Link público do evento, para mandar fora do app. */
export function eventLink(origin: string, eventId: string): string {
  return `${origin}/eventos/${encodeURIComponent(eventId)}`;
}

export function eventShareText(title: string): string {
  return `Olha esse evento no AskouT: ${title}`;
}
