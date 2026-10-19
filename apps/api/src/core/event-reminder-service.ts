import type { CoreDeps } from './ports.ts';
import type { EventRef } from './types.ts';

/** Quanto antes do começo o lembrete sai. */
export const EVENT_REMINDER_MINUTES = 30;
const BATCH = 200;
const MINUTE = 60_000;

/**
 * Lembrete push "seu evento começa em 30 minutos" para quem confirmou presença (e para o dono do evento).
 * Roda num job a cada minuto; cada pessoa recebe no máximo um lembrete por evento.
 */
export class EventReminderService {
  private readonly deps: CoreDeps;

  constructor(deps: CoreDeps) {
    this.deps = deps;
  }

  /** Devolve quantos lembretes mandou. */
  async sendDue(): Promise<number> {
    const { places, posts, eventRoom, notifier, clock } = this.deps;
    const now = clock.now();
    const until = new Date(now.getTime() + EVENT_REMINDER_MINUTES * MINUTE);
    const events: { ref: EventRef; title: string; startsAt: Date; where: string | null; ownerId: string | null }[] = [];

    const place = await places.searchEvents({ from: now, to: until, limit: BATCH });
    for (const { event, venue } of place) {
      if (event.startsAt > now && event.startsAt <= until) events.push({ ref: { source: 'PLACE', id: event.id }, title: event.title, startsAt: event.startsAt, where: venue.name, ownerId: null });
    }
    for (const { post } of await posts.listEventsStartingBetween(now, until, BATCH)) {
      if (post.eventTitle === null || post.eventStartsAt === null) continue;
      events.push({ ref: { source: 'USER', id: post.id }, title: post.eventTitle, startsAt: post.eventStartsAt, where: post.placeName, ownerId: post.authorId });
    }

    let sent = 0;
    for (const e of events) {
      const going = await eventRoom.listGoing(e.ref);
      const people = new Set(going.map((g) => g.userId));
      if (e.ownerId) people.add(e.ownerId);
      const minutes = Math.max(1, Math.round((e.startsAt.getTime() - now.getTime()) / MINUTE));
      for (const userId of people) {
        // Marca antes de avisar: se duas instâncias rodarem juntas, o pior caso é não avisar, nunca avisar em dobro.
        if (!(await eventRoom.markReminded(e.ref, userId, now))) continue;
        await notifier.notify({
          userId,
          type: 'EVENT_REMINDER',
          title: `Começa em ${minutes} min`,
          body: e.where ? `"${e.title}" · ${e.where}` : `"${e.title}"`,
          url: `/eventos/${e.ref.id}`,
          dedupeKey: `event:${e.ref.id}:reminder`,
        });
        sent += 1;
      }
    }
    return sent;
  }
}
