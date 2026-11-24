import type { EventPageService } from './event-page-service.ts';
import type { FlashService } from './flash-service.ts';
import type { MeetupService } from './meetup-service.ts';
import type { CoreDeps } from './ports.ts';

/** Quantos planos vão para o widget (a agenda grande mostra até 5; o resto serve para a linha do tempo andar sozinha). */
export const WIDGET_PLANS_MAX = 12;
/** Quantos amigos com o NOW ligado vão com nome (o resto entra só na contagem). */
export const WIDGET_FRIENDS_MAX = 6;

/** Um plano da agenda pessoal: encontro confirmado ou evento com "Eu vou". */
export interface WidgetPlan {
  /** `m:<encontro>` ou `e:<evento>`, como na agenda do app. */
  key: string;
  kind: 'MEETUP' | 'EVENT';
  title: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
  /** Tela do app que abre ao tocar. */
  url: string;
  /** Quantos confirmados (só nos encontros, contando quem organiza). */
  people: number | null;
}

/** Encontro do NOW aceito e ainda valendo (os dois combinaram de se ver agora). */
export interface WidgetNowMatch {
  id: string;
  withName: string;
  startedAt: string;
  expiresAt: string;
  /** Lugar escolhido no mapa; nulo enquanto ninguém escolheu. */
  placeName: string | null;
  url: string;
}

export interface WidgetFriend {
  name: string;
  username: string;
}

/**
 * Tudo o que os widgets da tela inicial e da tela bloqueada mostram, numa chamada só e sem posição de ninguém.
 * O widget escolhe, para cada instante da linha do tempo, o "encontro ativo" e o "próximo encontro" a partir de
 * `plans` e `matches`, então continua certo por horas sem buscar de novo.
 */
export interface WidgetSnapshot {
  /** Relógio do servidor. */
  now: string;
  /** Planos que ainda não terminaram, por início. */
  plans: WidgetPlan[];
  /** Encontros do NOW em andamento. */
  matches: WidgetNowMatch[];
  /** O seu NOW. */
  flash: { on: boolean; expiresAt: string | null };
  /** Amigos com o NOW ligado que você pode ver (os mesmos do raio no avatar), sem você. */
  friendsOnNow: { count: number; people: WidgetFriend[] };
  /** Convites do NOW esperando a sua resposta. */
  pendingInvites: number;
}

function firstName(displayName: string | null | undefined, username: string): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first && first.length > 0 ? first : username;
}

export class WidgetService {
  private readonly deps: CoreDeps;
  private readonly flash: FlashService;
  private readonly meetups: MeetupService;
  private readonly eventPages: EventPageService;

  constructor(deps: CoreDeps, services: { flash: FlashService; meetups: MeetupService; eventPages: EventPageService }) {
    this.deps = deps;
    this.flash = services.flash;
    this.meetups = services.meetups;
    this.eventPages = services.eventPages;
  }

  async snapshot(actorId: string): Promise<WidgetSnapshot> {
    const now = this.deps.clock.now();
    const nowMs = now.getTime();
    const [meetups, going, status, invites, activeIds, open] = await Promise.all([
      this.meetups.listMine(actorId),
      this.eventPages.listMyGoing(actorId),
      this.flash.status(actorId),
      this.flash.listInvites(actorId),
      this.flash.activeIds(actorId),
      this.deps.flash.listOpenInvitesFor(actorId, now),
    ]);

    // Mesma regra da agenda do app (apps/web/src/lib/agenda.ts, agendaEvents): encontro confirmado esconde o
    // "Eu vou" do mesmo evento.
    const mine = meetups.filter((m) => m.status === 'ACTIVE' && (m.myStatus === 'ORGANIZER' || m.myStatus === 'CONFIRMED'));
    const taken = new Set(mine.flatMap((m) => (m.eventRef ? [m.eventRef] : m.event ? [m.event.id] : [])));
    const plans: WidgetPlan[] = [
      ...mine.map((m) => ({
        key: `m:${m.id}`,
        kind: 'MEETUP' as const,
        title: m.title,
        startsAt: m.startsAt,
        endsAt: m.endsAt,
        venueName: m.event?.venueName ?? null,
        url: `/conversas/${m.conversationId}`,
        people: m.confirmedCount,
      })),
      ...going
        .filter((g) => !taken.has(g.id))
        .map((g) => ({ key: `e:${g.id}`, kind: 'EVENT' as const, title: g.title, startsAt: g.startsAt, endsAt: g.endsAt, venueName: g.venueName, url: `/eventos/${g.id}`, people: null })),
    ]
      .filter((p) => Date.parse(p.endsAt) > nowMs)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.key.localeCompare(b.key))
      .slice(0, WIDGET_PLANS_MAX);

    const records = new Map(open.map((r) => [r.id, r] as const));
    const matches: WidgetNowMatch[] = invites.matches
      .filter((m) => Date.parse(m.expiresAt) > nowMs)
      .map((m) => {
        const record = records.get(m.id);
        return {
          id: m.id,
          withName: firstName(m.other.displayName, m.other.username),
          startedAt: (record?.respondedAt ?? record?.createdAt ?? now).toISOString(),
          expiresAt: m.expiresAt,
          placeName: record?.destination?.name ?? null,
          url: `/now/encontro/${m.id}`,
        };
      })
      .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

    const friendIds = activeIds.filter((id) => id !== actorId);
    const profiles = friendIds.length > 0 ? await this.deps.users.findProfilesByIds(friendIds.slice(0, WIDGET_FRIENDS_MAX)) : [];
    const people = profiles.map((p) => ({ name: firstName(p.displayName, p.username), username: p.username }));

    return {
      now: now.toISOString(),
      plans,
      matches,
      flash: { on: status.active, expiresAt: status.expiresAt },
      friendsOnNow: { count: friendIds.length, people },
      pendingInvites: invites.received.length,
    };
  }
}
