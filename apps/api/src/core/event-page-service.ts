import { POST_VIDEO_MAX_BYTES, parseChatMedia } from './media.ts';
import { distanceMeters } from './geo.ts';
import { DomainError, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ProfileService } from './profile-service.ts';
import type { EventKind, EventRef, EventStoryMeta, PostReportReason, PublicProfile, StoryHiddenRecord } from './types.ts';
import { POST_REPORT_REASONS, toPublicProfile } from './types.ts';

/** Quantos avatares a página traz de uma vez. */
export const EVENT_ATTENDEES_LIMIT = 60;
/** Como os stories estão ocultos entre mim e uma pessoa (só o que eu mesmo escolhi). */
export interface StoryVisibilityView {
  /** Eu não vejo os stories dela. */
  hideTheirs: boolean;
  /** Ela não vê os meus stories. */
  hideMine: boolean;
}

/** Quem `userId` não enxerga nos stories: quem ele ocultou e quem escondeu os stories dele. */
function storiesUnseenBy(userId: string, rows: StoryHiddenRecord[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) {
    if (r.ownerId === userId && r.hideTheirs) out.add(r.otherId);
    if (r.otherId === userId && r.hideMine) out.add(r.ownerId);
  }
  return out;
}

/** Quanto tempo um story fica no ar (ou até o fim do evento, o que vier primeiro). */
export const EVENT_STORY_HOURS = 24;
/** Quantos stories no ar uma pessoa pode ter no mesmo evento. */
export const EVENT_STORY_MAX_PER_USER = 10;
export const EVENT_STORY_REPORT_DETAILS_MAX = 300;

export interface EventStoryItemView {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  createdAt: string;
  expiresAt: string;
  canDelete: boolean;
}

/** Os stories de uma pessoa no evento. */
export interface EventStoryGroupView {
  author: PublicProfile;
  mine: boolean;
  items: EventStoryItemView[];
}

/** Onde a pessoa está: o evento do story, o local e o que dá para saber dele num relance. */
export interface ProfileStoryEventView {
  id: string;
  title: string;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  /** Nome do local (do evento do local ou o lugar informado no evento criado por uma pessoa). */
  place: string | null;
  address: string | null;
  cover: EventCoverView | null;
  confirmedCount: number;
  /** Quem vê também confirmou presença. */
  going: boolean;
  isFree: boolean;
  sample: boolean;
}

/** Story na página inicial: vem de um evento; `event` é null quando quem vê não tem acesso a ele. */
export interface ProfileStoryItemView extends EventStoryItemView {
  event: ProfileStoryEventView | null;
}

/** Os stories que uma pessoa publicou também no perfil (os seus e os dos amigos). */
export interface ProfileStoryGroupView {
  author: PublicProfile;
  mine: boolean;
  items: ProfileStoryItemView[];
}

/** A capa: o que o dono enviou, a foto que o Google deu para o lugar ou a imagem do evento do local. */
export type EventCoverView =
  | { kind: 'URL'; url: string }
  | { kind: 'UPLOAD'; imageId: string }
  | { kind: 'PLACE'; photoRef: string; author: string | null };

export interface EventPageView {
  id: string;
  /** PLACE: evento do local (Explorar). USER: evento criado por uma pessoa. */
  source: 'PLACE' | 'USER';
  title: string;
  description: string | null;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  isFree: boolean;
  /** Dado de exemplo para teste, nunca um evento real. */
  sample: boolean;
  cover: EventCoverView | null;
  /** Só em evento de um local: abre a página do estabelecimento. */
  venue: { id?: string; name: string; address: string | null; lat: number | null; lng: number | null };
  tags: string[];
  /** Só em evento do local: link https para comprar ingresso, quando o local informou. */
  ticketUrl: string | null;
  distanceM: number | null;
  /** Só em evento do local: o visitante já postou no próprio perfil. */
  postedByMe: boolean;
  /** Evento privado: só chega por cartão numa conversa e não pode ser repostado. */
  isPrivate: boolean;
  /** Confirmados, contando o dono (que está confirmado por ser dono). */
  confirmedCount: number;
  /** O visitante confirmou (o dono sempre está). */
  going: boolean;
  /** O dono primeiro, depois quem confirmou, em ordem. Sem quem tem bloqueio com o visitante. */
  attendees: PublicProfile[];
  owner: PublicProfile | null;
  isOwner: boolean;
  /** Quem tem story no ar neste evento (para o círculo no avatar). */
  storyUserIds: string[];
  /** O visitante pode publicar story: confirmou presença (ou é o dono) e o evento não acabou. */
  canStory: boolean;
}

/** Evento em que a pessoa confirmou presença, no formato curto que a agenda usa. */
export interface GoingEventView {
  id: string;
  source: 'PLACE' | 'USER';
  title: string;
  startsAt: string;
  endsAt: string;
  venueName: string | null;
}

/** Quantos eventos confirmados a agenda recebe, no máximo. */
export const MY_GOING_LIMIT = 100;

function optionalText(value: unknown, max: number, field: string, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError('Dados inválidos', { [field]: `${label} inválido` });
  const text = value.trim().replace(/\r\n/g, '\n');
  if (text === '') return null;
  if (Array.from(text).length > max) throw validationError('Dados inválidos', { [field]: `${label} pode ter até ${max} caracteres` });
  return text;
}

function parseId(id: unknown): string {
  if (typeof id !== 'string' || id === '' || id.length > 64) throw notFound('Evento não encontrado');
  return id;
}

interface Resolved {
  ref: EventRef;
  owner: PublicProfile | null;
}

/** Página do evento: capa, confirmados ("Eu vou") e posts dentro do evento (só eventos criados por pessoas). */
export class EventPageService {
  private readonly deps: CoreDeps;
  private readonly profiles: ProfileService;

  constructor(deps: CoreDeps, profiles: ProfileService) {
    this.deps = deps;
    this.profiles = profiles;
  }

  /** O evento existe e o visitante pode vê-lo? Evento de pessoa segue a regra de privacidade do post. */
  private async resolve(viewerId: string, rawId: unknown): Promise<Resolved> {
    const id = parseId(rawId);
    if (await this.deps.places.findEvent(id)) return { ref: { source: 'PLACE', id }, owner: null };
    const found = await this.deps.posts.findById(id);
    const post = found?.post;
    if (!post || post.eventTitle === null || !post.eventStartsAt || !post.eventEndsAt) throw notFound('Evento não encontrado');
    if (post.archivedAt !== null && post.authorId !== viewerId) throw notFound('Evento não encontrado');
    if (post.authorId !== viewerId) {
      if (await this.deps.blocks.existsEitherWay(viewerId, post.authorId)) throw notFound('Evento não encontrado');
      const author = await this.deps.users.findProfileById(post.authorId);
      if (!author) throw notFound('Evento não encontrado');
      let canSee = false;
      try {
        canSee = (await this.profiles.getByUsername(viewerId, author.username)).canViewContent;
      } catch {
        canSee = false;
      }
      // Quem recebeu o cartão numa conversa abre o evento mesmo sem seguir o dono; evento privado só abre assim.
      if (post.eventPrivate) canSee = false;
      if (!canSee && !(await this.deps.conversations.hasPostEventAccess(viewerId, post.id))) throw notFound('Evento não encontrado');
    }
    const authorProfile = await this.deps.users.findProfileById(post.authorId);
    return { ref: { source: 'USER', id }, owner: authorProfile ? toPublicProfile(authorProfile) : null };
  }

  async get(viewerId: string, rawId: unknown, input: { lat?: number; lng?: number } = {}): Promise<EventPageView> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));

    const base = await this.base(viewerId, ref, input);
    const going = await this.deps.eventRoom.listGoing(ref);
    const goingIds = going.map((g) => g.userId).filter((u) => u !== owner?.userId);
    const ordered = [...(owner ? [owner.userId] : []), ...goingIds];
    const visibleIds = ordered.filter((u) => u === viewerId || !hidden.has(u));
    const profiles = await this.deps.users.findProfilesByIds(visibleIds.slice(0, EVENT_ATTENDEES_LIMIT));
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const attendees = visibleIds.flatMap((u) => {
      const p = byId.get(u);
      return p ? [p] : [];
    });

    const isOwner = owner?.userId === viewerId;
    const iGo = isOwner || going.some((g) => g.userId === viewerId);
    return {
      ...base.view,
      confirmedCount: ordered.length,
      going: iGo,
      attendees,
      owner,
      isOwner,
      storyUserIds: [...new Set((await this.visibleStories(viewerId, ref, hidden)).map((s) => s.userId))],
      canStory: (isOwner || iGo) && Date.parse(base.view.endsAt) > this.deps.clock.now().getTime(),
    };
  }

  private async base(viewerId: string, ref: EventRef, input: { lat?: number; lng?: number }): Promise<{ view: Omit<EventPageView, 'confirmedCount' | 'going' | 'attendees' | 'owner' | 'isOwner' | 'storyUserIds' | 'canStory'> }> {
    if (ref.source === 'PLACE') {
      const found = await this.deps.places.findEvent(ref.id);
      if (!found) throw notFound('Evento não encontrado');
      const { event, venue } = found;
      const distance = input.lat !== undefined && input.lng !== undefined ? Math.round(distanceMeters({ lat: input.lat, lng: input.lng }, venue)) : null;
      return {
        view: {
          id: event.id,
          source: 'PLACE',
          title: event.title,
          description: event.description,
          kind: event.kind,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          isFree: event.isFree,
          sample: event.isSample || venue.isSample,
          cover: event.imageUrl ? { kind: 'URL', url: event.imageUrl } : null,
          venue: { id: venue.id, name: venue.name, address: venue.address, lat: venue.lat, lng: venue.lng },
          tags: [...event.tags],
          ticketUrl: event.ticketUrl ?? null,
          distanceM: distance,
          postedByMe: await this.deps.profileEvents.has(viewerId, event.id),
          isPrivate: false,
        },
      };
    }
    const found = await this.deps.posts.findById(ref.id);
    const title = found?.post.eventTitle;
    const startsAt = found?.post.eventStartsAt;
    const endsAt = found?.post.eventEndsAt;
    if (!found || !title || !startsAt || !endsAt) throw notFound('Evento não encontrado');
    const { post, images } = found;
    const first = [...images].sort((a, b) => a.position - b.position)[0];
    const cover: EventCoverView | null = !first ? null : first.isUpload ? { kind: 'UPLOAD', imageId: first.id } : first.placePhotoRef ? { kind: 'PLACE', photoRef: first.placePhotoRef, author: first.placePhotoAuthor } : null;
    return {
      view: {
        id: post.id,
        source: 'USER',
        title,
        description: post.caption,
        kind: post.eventKind,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        isFree: false,
        sample: false,
        cover,
        venue: { name: post.placeName ?? '', address: post.placeAddress, lat: null, lng: null },
        tags: [],
        ticketUrl: null,
        distanceM: null,
        postedByMe: await this.deps.profileEvents.hasPost(viewerId, post.id),
        isPrivate: post.eventPrivate === true,
      },
    };
  }

  /**
   * Para o feed do evento: o visitante pode abrir o evento? Devolve quem modera (o dono do evento criado por uma pessoa
   * ou quem administra o local do evento) e o título, para os avisos.
   */
  async access(viewerId: string, rawId: unknown): Promise<{ ref: EventRef; moderatorId: string | null; title: string }> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    if (ref.source === 'PLACE') {
      const found = await this.deps.places.findEvent(ref.id);
      if (!found) throw notFound('Evento não encontrado');
      return { ref, moderatorId: found.venue.ownerId ?? null, title: found.event.title };
    }
    const found = await this.deps.posts.findById(ref.id);
    return { ref, moderatorId: owner?.userId ?? null, title: found?.post.eventTitle ?? 'Evento' };
  }

  /** Eventos que ainda não acabaram e em que a pessoa vai: os que confirmou ("Eu vou") e os que ela criou, do mais próximo ao mais distante. Os que sumiram, foram arquivados ou ficaram inacessíveis (bloqueio) não entram. */
  async listMyGoing(viewerId: string): Promise<GoingEventView[]> {
    const now = this.deps.clock.now().getTime();
    const rows = await this.deps.eventRoom.listGoingByUser(viewerId, MY_GOING_LIMIT);
    const out: GoingEventView[] = [];
    for (const row of rows) {
      try {
        await this.resolve(viewerId, row.ref.id);
        const { view } = await this.base(viewerId, row.ref, {});
        if (Date.parse(view.endsAt) < now) continue;
        out.push({ id: view.id, source: view.source, title: view.title, startsAt: view.startsAt, endsAt: view.endsAt, venueName: view.venue.name === '' ? null : view.venue.name });
      } catch (failure) {
        if (!(failure instanceof DomainError)) throw failure;
      }
    }
    // Os que ela criou: o dono já conta como confirmado.
    const seen = new Set(out.map((e) => e.id));
    const created = await this.deps.posts.listFor([viewerId], [], { limit: MY_GOING_LIMIT, offset: 0 }, 'EVENT');
    for (const { post } of created) {
      if (post.authorId !== viewerId || post.archivedAt !== null || seen.has(post.id)) continue;
      if (post.eventTitle === null || !post.eventStartsAt || !post.eventEndsAt || post.eventEndsAt.getTime() < now) continue;
      out.push({ id: post.id, source: 'USER', title: post.eventTitle, startsAt: post.eventStartsAt.toISOString(), endsAt: post.eventEndsAt.toISOString(), venueName: post.placeName });
    }
    return out.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  }

  /** "Eu vou". O dono já conta como confirmado: confirmar de novo não muda nada. */
  async go(viewerId: string, rawId: unknown): Promise<EventPageView> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    if (owner?.userId !== viewerId) {
      const found = ref.source === 'PLACE' ? await this.deps.places.findEvent(ref.id) : await this.deps.posts.findById(ref.id);
      if (!found) throw notFound('Evento não encontrado');
      await this.deps.eventRoom.addGoing(ref, viewerId, this.deps.clock.now());
    }
    return this.get(viewerId, ref.id);
  }

  async cancel(viewerId: string, rawId: unknown): Promise<EventPageView> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    if (owner?.userId === viewerId) throw forbidden('Você é o dono: o evento já conta com você. Apague o evento se não vai mais acontecer.');
    await this.deps.eventRoom.removeGoing(ref, viewerId);
    return this.get(viewerId, ref.id);
  }

  /**
   * Os stories no ar que `viewerId` pode ver: sem quem tem bloqueio com ele, sem os que ele denunciou
   * e sem os de quem ele ocultou (ou que esconderam os stories dele).
   */
  private async visibleStories(viewerId: string, ref: EventRef, hidden: Set<string>): Promise<EventStoryMeta[]> {
    const unseen = storiesUnseenBy(viewerId, await this.deps.eventRoom.listStoryHidden(viewerId));
    const rows = (await this.deps.eventRoom.listStories(ref, this.deps.clock.now())).filter((s) => s.userId === viewerId || (!hidden.has(s.userId) && !unseen.has(s.userId)));
    const reported = await this.deps.eventRoom.reportedStoryIds(viewerId, rows.map((r) => r.id));
    return rows.filter((r) => !reported.has(r.id));
  }

  /** Denuncia um story. Fica guardado para a gestão e quem denunciou deixa de vê-lo. */
  async reportStory(viewerId: string, rawId: unknown, storyId: unknown, reason: unknown, details?: unknown): Promise<{ reported: true }> {
    const { ref } = await this.resolve(viewerId, rawId);
    const story = typeof storyId === 'string' && storyId.length <= 64 ? await this.deps.eventRoom.findStory(storyId) : undefined;
    if (!story || story.ref.id !== ref.id || story.expiresAt.getTime() <= this.deps.clock.now().getTime()) throw notFound('Story não encontrado');
    if (story.userId === viewerId) throw forbidden('Este story é seu: apague-o se não quiser mais');
    if (typeof reason !== 'string' || !(POST_REPORT_REASONS as readonly string[]).includes(reason)) throw validationError('Motivo inválido', { reason: 'Escolha um motivo da lista' });
    const text = optionalText(details, EVENT_STORY_REPORT_DETAILS_MAX, 'details', 'Detalhes');
    await this.deps.eventRoom.reportStory({ id: this.deps.ids.next(), storyId: story.id, reporterId: viewerId, reason: reason as PostReportReason, details: text, createdAt: this.deps.clock.now() });
    return { reported: true };
  }

  /** Stories no ar, agrupados por pessoa (os seus primeiro). Quem tem bloqueio com você não aparece. */
  async stories(viewerId: string, rawId: unknown): Promise<EventStoryGroupView[]> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    const rows = await this.visibleStories(viewerId, ref, hidden);
    const profiles = await this.deps.users.findProfilesByIds([...new Set(rows.map((r) => r.userId))]);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const groups = new Map<string, EventStoryGroupView>();
    for (const r of rows) {
      const author = byId.get(r.userId);
      if (!author) continue;
      const group = groups.get(r.userId) ?? { author, mine: r.userId === viewerId, items: [] };
      group.items.push({ id: r.id, kind: r.video ? 'VIDEO' : 'IMAGE', createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), canDelete: r.userId === viewerId || owner?.userId === viewerId });
      groups.set(r.userId, group);
    }
    const last = (g: EventStoryGroupView) => g.items[g.items.length - 1]!.createdAt;
    return [...groups.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : 0));
  }

  /**
   * Página inicial: os stories que você e seus amigos (seguimento mútuo) escolheram publicar também no perfil.
   * Os seus primeiro; depois quem publicou por último. Sem bloqueados, sem os que você denunciou
   * e sem quem você ocultou (ou que escondeu os stories de você).
   */
  async profileStories(viewerId: string): Promise<ProfileStoryGroupView[]> {
    const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    for (const id of storiesUnseenBy(viewerId, await this.deps.eventRoom.listStoryHidden(viewerId))) hidden.add(id);
    const friends = (await this.deps.follows.listFriendIds(viewerId)).filter((id) => !hidden.has(id));
    const all = await this.deps.eventRoom.listProfileStories([viewerId, ...friends], this.deps.clock.now());
    const reported = await this.deps.eventRoom.reportedStoryIds(viewerId, all.map((r) => r.id));
    const rows = all.filter((r) => !reported.has(r.id));
    const profiles = await this.deps.users.findProfilesByIds([...new Set(rows.map((r) => r.userId))]);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const events = new Map<string, ProfileStoryEventView | null>();
    for (const r of rows) {
      if (events.has(r.ref.id)) continue;
      events.set(r.ref.id, await this.eventLabel(viewerId, r.ref));
    }
    const groups = new Map<string, ProfileStoryGroupView>();
    for (const r of rows) {
      const author = byId.get(r.userId);
      if (!author) continue;
      const mine = r.userId === viewerId;
      const group = groups.get(r.userId) ?? { author, mine, items: [] };
      group.items.push({ id: r.id, kind: r.video ? 'VIDEO' : 'IMAGE', createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), canDelete: mine, event: events.get(r.ref.id) ?? null });
      groups.set(r.userId, group);
    }
    const last = (g: ProfileStoryGroupView) => g.items[g.items.length - 1]!.createdAt;
    return [...groups.values()].sort((a, b) => Number(b.mine) - Number(a.mine) || (last(a) < last(b) ? 1 : last(a) > last(b) ? -1 : 0));
  }

  /** O evento do story na página inicial, se quem vê consegue abrir o evento. */
  private async eventLabel(viewerId: string, ref: EventRef): Promise<ProfileStoryEventView | null> {
    let page: EventPageView;
    try {
      page = await this.get(viewerId, ref.id);
    } catch {
      return null;
    }
    return {
      id: page.id,
      title: page.title,
      kind: page.kind,
      startsAt: page.startsAt,
      endsAt: page.endsAt,
      place: page.venue.name || null,
      address: page.venue.address,
      cover: page.cover,
      confirmedCount: page.confirmedCount,
      going: page.going,
      isFree: page.isFree,
      sample: page.sample,
    };
  }

  /** O story aparece para `viewerId` na página inicial: está no perfil, no ar, e é dele ou de um amigo sem bloqueio. */
  private async profileStoryFor(viewerId: string, storyId: unknown): Promise<EventStoryMeta> {
    const story = typeof storyId === 'string' && storyId.length <= 64 ? await this.deps.eventRoom.findStory(storyId) : undefined;
    const visible =
      story !== undefined &&
      story.onProfile === true &&
      story.expiresAt.getTime() > this.deps.clock.now().getTime() &&
      (story.userId === viewerId ||
        ((await this.deps.follows.listFriendIds(viewerId)).includes(story.userId) &&
          !(await this.deps.blocks.existsEitherWay(viewerId, story.userId)) &&
          !storiesUnseenBy(viewerId, await this.deps.eventRoom.listStoryHidden(viewerId)).has(story.userId)));
    if (!visible) throw notFound('Story não encontrado');
    return story;
  }

  /** Como os stories estão ocultos entre mim e essa pessoa (só o que eu mesmo escolhi). */
  async storyVisibility(actorId: string, otherId: string): Promise<StoryVisibilityView> {
    const row = (await this.deps.eventRoom.listStoryHidden(actorId)).find((r) => r.ownerId === actorId && r.otherId === otherId);
    return { hideTheirs: row?.hideTheirs ?? false, hideMine: row?.hideMine ?? false };
  }

  /**
   * `hideTheirs`: eu deixo de ver os stories dela. `hideMine`: ela deixa de ver os meus.
   * Vale na página inicial e nos stories dos eventos. Só o que vier no pedido muda.
   */
  async setStoryVisibility(actorId: string, otherId: string, input: { hideTheirs?: unknown; hideMine?: unknown }): Promise<StoryVisibilityView> {
    if (actorId === otherId) throw validationError('Você não pode ocultar seus stories de si mesmo');
    for (const key of ['hideTheirs', 'hideMine'] as const) {
      if (input[key] !== undefined && typeof input[key] !== 'boolean') throw validationError('Confira os dados', { [key]: 'Use verdadeiro ou falso' });
    }
    const [other] = await this.deps.users.findProfilesByIds([otherId]);
    if (!other) throw notFound('Pessoa não encontrada');
    const current = await this.storyVisibility(actorId, otherId);
    const next: StoryVisibilityView = {
      hideTheirs: typeof input.hideTheirs === 'boolean' ? input.hideTheirs : current.hideTheirs,
      hideMine: typeof input.hideMine === 'boolean' ? input.hideMine : current.hideMine,
    };
    await this.deps.eventRoom.setStoryHidden({ ownerId: actorId, otherId, ...next });
    return next;
  }

  /** Apaga, pela página inicial, um story seu (some do evento também). */
  async deleteProfileStory(viewerId: string, storyId: unknown): Promise<{ deleted: true }> {
    const story = await this.profileStoryFor(viewerId, storyId);
    if (story.userId !== viewerId) throw forbidden('Só quem publicou apaga o story por aqui');
    await this.deps.eventRoom.deleteStory(story.id);
    return { deleted: true };
  }

  /** Denuncia, pela página inicial, o story de um amigo. */
  async reportProfileStory(viewerId: string, storyId: unknown, reason: unknown, details?: unknown): Promise<{ reported: true }> {
    const story = await this.profileStoryFor(viewerId, storyId);
    if (story.userId === viewerId) throw forbidden('Este story é seu: apague-o se não quiser mais');
    if (typeof reason !== 'string' || !(POST_REPORT_REASONS as readonly string[]).includes(reason)) throw validationError('Motivo inválido', { reason: 'Escolha um motivo da lista' });
    const text = optionalText(details, EVENT_STORY_REPORT_DETAILS_MAX, 'details', 'Detalhes');
    await this.deps.eventRoom.reportStory({ id: this.deps.ids.next(), storyId: story.id, reporterId: viewerId, reason: reason as PostReportReason, details: text, createdAt: this.deps.clock.now() });
    return { reported: true };
  }

  /** Publica um story. Só quem confirmou presença (ou o dono), enquanto o evento não acabou. Foto até 2 MB ou vídeo até 60 MB. */
  async createStory(viewerId: string, rawId: unknown, contentType: unknown, bytes: unknown, onProfile?: unknown): Promise<EventStoryGroupView> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    const isOwner = owner?.userId === viewerId;
    if (!isOwner && !(await this.deps.eventRoom.isGoing(ref, viewerId))) throw forbidden('Confirme presença para publicar um story neste evento');
    const { view } = await this.base(viewerId, ref, {});
    const now = this.deps.clock.now();
    const endsAt = Date.parse(view.endsAt);
    if (endsAt <= now.getTime()) throw forbidden('Esse evento já terminou');
    const mine = (await this.deps.eventRoom.listStories(ref, now)).filter((s) => s.userId === viewerId);
    if (mine.length >= EVENT_STORY_MAX_PER_USER) throw validationError('Muitos stories', { media: `Você já tem ${EVENT_STORY_MAX_PER_USER} stories no ar neste evento` });
    const media = parseChatMedia(contentType, bytes, POST_VIDEO_MAX_BYTES);
    const expiresAt = new Date(Math.min(now.getTime() + EVENT_STORY_HOURS * 3_600_000, endsAt));
    const record = { id: this.deps.ids.next(), ref, userId: viewerId, mime: media.mime, video: media.kind === 'VIDEO', onProfile: onProfile === true, data: media.data, createdAt: now, expiresAt };
    await this.deps.eventRoom.addStory(record);
    const me = await this.deps.users.findProfileById(viewerId);
    return { author: toPublicProfile(me!), mine: true, items: [{ id: record.id, kind: media.kind, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), canDelete: true }] };
  }

  async deleteStory(viewerId: string, rawId: unknown, storyId: unknown): Promise<{ deleted: true }> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    const story = typeof storyId === 'string' && storyId.length <= 64 ? await this.deps.eventRoom.findStory(storyId) : undefined;
    if (!story || story.ref.id !== ref.id) throw notFound('Story não encontrado');
    if (story.userId !== viewerId && owner?.userId !== viewerId) throw forbidden('Só quem publicou ou o dono do evento apaga o story');
    await this.deps.eventRoom.deleteStory(story.id);
    return { deleted: true };
  }

  /** A mídia de um story, para <img>/<video>. Público (como os stories), mas só enquanto está no ar. */
  async storyMedia(storyId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof storyId !== 'string' || storyId === '' || storyId.length > 64) return undefined;
    const media = await this.deps.eventRoom.findStoryMedia(storyId);
    if (!media || media.expiresAt.getTime() <= this.deps.clock.now().getTime()) return undefined;
    return { mime: media.mime, data: media.data };
  }

}
