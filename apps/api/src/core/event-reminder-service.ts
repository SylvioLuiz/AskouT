import type { CoreDeps, EventReminderSettings, NotificationRepository } from './ports.ts';
import type { EventRef } from './types.ts';
import { DEFAULT_EVENT_REMINDERS, dueReminder, MAX_REMINDER_LEAD_MS, reminderText } from './event-reminders.ts';
import type { EventReminderOption } from './event-reminders.ts';

const BATCH = 2000;
const MINUTE = 60_000;
/** Eventos que começam até daqui a 2 h: olhados a cada minuto (lembretes de minutos e horas). */
const NEAR_MS = 120 * MINUTE;
/** Os que começam depois disso (até 1 dia): "É amanhã!" e "É hoje!" toleram atraso, então basta olhar a cada 5 min. */
const FAR_EVERY_MS = 5 * MINUTE;

interface Candidate {
  ref: EventRef;
  userId: string;
  /** Quando confirmou (ou criou o evento, se é o dono). */
  joinedAt: Date;
  startsAt: Date;
}

const refKey = (ref: EventRef): string => `${ref.source}:${ref.id}`;

/**
 * Lembretes push de evento para quem confirmou presença (e para o dono do evento de pessoa): quantos e quando, cada
 * pessoa escolhe (no geral e por evento); quem nunca mexeu recebe "É hoje!" de manhã e "Começa daqui a pouco" 30 min
 * antes. Roda num job a cada minuto; cada lembrete sai no máximo uma vez por pessoa e evento. Silenciar eventos e o
 * som escolhido valem como em qualquer aviso (o Notifier cuida disso).
 */
export class EventReminderService {
  private readonly deps: CoreDeps;
  private readonly settings: Pick<NotificationRepository, 'getEventReminderSettings'>;
  private farCheckedAt: number | null = null;

  constructor(deps: CoreDeps, settings: Pick<NotificationRepository, 'getEventReminderSettings'>) {
    this.deps = deps;
    this.settings = settings;
  }

  /** Devolve quantos lembretes mandou. */
  async sendDue(): Promise<number> {
    const now = this.deps.clock.now();
    const near = new Date(now.getTime() + NEAR_MS);
    const ranges: [Date, Date][] = [[now, near]];
    if (this.farCheckedAt === null || now.getTime() - this.farCheckedAt >= FAR_EVERY_MS) {
      ranges.push([near, new Date(now.getTime() + MAX_REMINDER_LEAD_MS)]);
      this.farCheckedAt = now.getTime();
    }
    let sent = 0;
    for (const [from, to] of ranges) sent += await this.sendBetween(now, from, to);
    return sent;
  }

  private async sendBetween(now: Date, from: Date, to: Date): Promise<number> {
    const { posts, eventRoom } = this.deps;
    const candidates = new Map<string, Candidate>();
    const add = (c: Candidate) => {
      const key = `${refKey(c.ref)}|${c.userId}`;
      const had = candidates.get(key);
      if (!had || had.joinedAt > c.joinedAt) candidates.set(key, c);
    };
    for (const g of await eventRoom.listGoingStartingBetween(from, to, BATCH)) add({ ref: g.ref, userId: g.userId, joinedAt: g.createdAt, startsAt: g.startsAt });
    const userEvents = new Map<string, { title: string; where: string | null }>();
    for (const { post } of await posts.listEventsStartingBetween(from, to, BATCH)) {
      if (post.eventTitle === null || post.eventStartsAt === null) continue;
      userEvents.set(post.id, { title: post.eventTitle, where: post.placeName });
      add({ ref: { source: 'USER', id: post.id }, userId: post.authorId, joinedAt: post.createdAt, startsAt: post.eventStartsAt });
    }
    if (candidates.size === 0) return 0;

    const all = [...candidates.values()];
    const refs = [...new Map(all.map((c) => [refKey(c.ref), c.ref])).values()];
    const [settings, choices] = await Promise.all([
      this.settings.getEventReminderSettings([...new Set(all.map((c) => c.userId))]).catch(() => new Map<string, EventReminderSettings>()),
      eventRoom.listReminderChoices(refs),
    ]);
    const chosen = new Map(choices.map((c) => [`${refKey(c.ref)}|${c.userId}`, c.reminders]));

    let sent = 0;
    for (const c of all) {
      const general = settings.get(c.userId);
      const options: readonly EventReminderOption[] = chosen.get(`${refKey(c.ref)}|${c.userId}`) ?? general?.reminders ?? DEFAULT_EVENT_REMINDERS;
      const timeZone = general?.timeZone ?? null;
      const due = dueReminder({ options, startsAt: c.startsAt, joinedAt: c.joinedAt, now, timeZone });
      // Os que vencem junto com um mais perto do começo não saem: só ficam marcados.
      for (const kind of due.skip) await eventRoom.markReminded(c.ref, c.userId, kind, now);
      if (!due.send) continue;
      // Marca antes de avisar: se duas instâncias rodarem juntas, o pior caso é não avisar, nunca avisar em dobro.
      if (!(await eventRoom.markReminded(c.ref, c.userId, due.send, now))) continue;
      const info = await this.describe(c.ref, userEvents);
      if (!info) continue;
      const text = reminderText({ option: due.send, title: info.title, where: info.where, startsAt: c.startsAt, now, timeZone });
      await this.deps.notifier.notify({ userId: c.userId, type: 'EVENT_REMINDER', title: text.title, body: text.body, url: `/eventos/${c.ref.id}`, dedupeKey: `event:${c.ref.id}:reminder:${due.send}` });
      sent += 1;
    }
    return sent;
  }

  /** Título e lugar do evento (os de pessoa já vieram na busca; os do local são lidos um a um, só quando algo sai). */
  private async describe(ref: EventRef, userEvents: Map<string, { title: string; where: string | null }>): Promise<{ title: string; where: string | null } | undefined> {
    if (ref.source === 'USER') {
      const known = userEvents.get(ref.id);
      if (known) return known;
      const found = await this.deps.posts.findById(ref.id);
      return found?.post.eventTitle ? { title: found.post.eventTitle, where: found.post.placeName } : undefined;
    }
    const found = await this.deps.places.findEvent(ref.id);
    return found ? { title: found.event.title, where: found.venue.name } : undefined;
  }
}
