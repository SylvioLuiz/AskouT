import { canOpenByInvite } from './event-invites.ts';
import { VISITOR_ID } from './visitor.ts';
import { POST_VIDEO_MAX_BYTES, parseChatMedia } from './media.ts';
import { parseStoryOverlays } from './story-overlays.ts';
import type { StoryOverlay } from './story-overlays.ts';
import { distanceMeters } from './geo.ts';
import { DomainError, conflict, forbidden, notFound, validationError } from './errors.ts';
import { buildEventCards } from './event-card.ts';
import { loadEventExtras, resolveEventExtras } from './event-extras.ts';
import type { EventExtraView } from './event-extras.ts';
import type { EventCardView } from './event-card.ts';
import { parsePage } from './profile-event-service.ts';
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
/** Texto por cima do story: curto, como no Instagram. */
export const EVENT_STORY_CAPTION_MAX = 200;
/** Linhas do texto do story (o resto vira espaço). */
export const EVENT_STORY_CAPTION_LINES = 6;

export interface EventStoryItemView {
  id: string;
  kind: 'IMAGE' | 'VIDEO';
  /** Texto por cima da mídia (null se não tem) e a altura dele na tela, de 0 (topo) a 1 (pé). */
  caption: string | null;
  captionY: number | null;
  createdAt: string;
  expiresAt: string;
  canDelete: boolean;
  /** Textos e figurinhas por cima da mídia (só quando há). */
  overlays?: StoryOverlay[];
  /** Você curtiu este story (só nos stories de outras pessoas). */
  liked?: boolean;
  /** Quantas pessoas viram o story (só nos seus: quem publicou é o único que vê). */
  views?: number;
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
  startsAt: string | null;
  endsAt: string | null;
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
  | { kind: 'UPLOAD'; imageId: string; /** A capa é a imagem de um vídeo: a página toca o vídeo ao segurar a capa. */ video?: boolean }
  | { kind: 'PLACE'; photoRef: string; author: string | null };

export interface EventPageView {
  id: string;
  /** PLACE: evento do local (Explorar). USER: evento criado por uma pessoa. */
  source: 'PLACE' | 'USER';
  title: string;
  description: string | null;
  kind: EventKind;
  /** Nulo em evento de pessoa cuja data ainda vai ser decidida numa votação. */
  startsAt: string | null;
  endsAt: string | null;
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
  /** Configurações de evento respondidas por quem criou (ícone, nome e resposta), na ordem da gestão. */
  extras: EventExtraView[];
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
  /** Só quando o visitante confirmou: escolheu mostrar o evento na aba Eventos do perfil (senão fica na aba Participou, só dele). */
  goingOnProfile: boolean;
  /**
   * Evento ainda sem data com votação aberta: o id dela, para quem criou (editar) e para quem participa (votar).
   * Nulo também quando não há votação: quem criou vê o botão para abrir uma.
   */
  datePollId: string | null;
  /**
   * Grupo (conversa) do evento em que o visitante está: o criado para o evento, o da votação da data ou o do encontro
   * que ele combinou a partir do evento. Nulo se não está em nenhum.
   */
  group: { conversationId: string; name: string } | null;
  /** Quem criou o evento (de pessoa) ainda não está num grupo dele: vê o botão para criar. */
  canCreateGroup: boolean;
}

/** Pessoa convidada para um evento criado por uma pessoa. */
export interface EventInviteView {
  user: PublicProfile;
  /** Quem convidou (nulo se apagou a conta). */
  invitedBy: PublicProfile | null;
  invitedAt: string;
  /** Também está marcada no evento (e não recusou a marcação). */
  tagged: boolean;
  /** PENDING: ainda não respondeu (dá para cancelar); ACCEPTED: aceitou; DECLINED: recusou (dá para convidar de novo). */
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED';
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

/** Evento em que a pessoa confirmou presença ("Eu vou"), para as abas Eventos e Participou do perfil. */
export interface AttendedEventView extends EventCardView {
  /** Quando ela confirmou presença. */
  attendedAt: string;
}

export interface AttendedEventsPage {
  items: AttendedEventView[];
  total: number;
  limit: number;
  offset: number;
}

/** Quantas presenças as abas Eventos e Participou percorrem, no máximo. */
export const ATTENDED_SCAN_LIMIT = 500;

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

/** Texto e altura do story para a tela. */
function captionOf(r: { caption?: string | null; captionY?: number | null }): { caption: string | null; captionY: number | null } {
  const caption = r.caption ?? null;
  return { caption, captionY: caption === null ? null : (r.captionY ?? 0.5) };
}

/** Confere o texto do story: até {@link EVENT_STORY_CAPTION_MAX} caracteres e {@link EVENT_STORY_CAPTION_LINES} linhas; altura entre 0 e 1. */
export function parseStoryCaption(text: unknown, y: unknown): { caption: string | null; captionY: number | null } {
  const raw = optionalText(text, EVENT_STORY_CAPTION_MAX, 'caption', 'Texto');
  if (raw === null) return { caption: null, captionY: null };
  const lines = raw.split('\n').map((line) => line.trimEnd());
  const caption = [...lines.slice(0, EVENT_STORY_CAPTION_LINES), ...(lines.length > EVENT_STORY_CAPTION_LINES ? [lines.slice(EVENT_STORY_CAPTION_LINES).join(' ')] : [])]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const n = typeof y === 'number' ? y : typeof y === 'string' && y.trim() !== '' ? Number(y) : NaN;
  const captionY = Number.isFinite(n) ? Math.round(Math.min(0.9, Math.max(0.1, n)) * 1000) / 1000 : 0.5;
  return { caption, captionY };
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
    if (!post || post.eventTitle === null) throw notFound('Evento não encontrado');
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
      // Quem foi convidado (marcado ou recebeu o cartão numa conversa) abre o evento mesmo sem seguir o dono; evento privado só abre assim.
      if (post.eventPrivate) canSee = false;
      if (!canSee && !(await canOpenByInvite(this.deps, viewerId, post.id))) throw notFound('Evento não encontrado');
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
      // Evento sem data (em votação) ainda não acabou: dá para postar flash.
      canStory: (isOwner || iGo) && (base.view.endsAt === null || Date.parse(base.view.endsAt) > this.deps.clock.now().getTime()),
      goingOnProfile: !isOwner && iGo ? (await this.deps.eventRoom.goingOnProfile(ref, viewerId)) === true : false,
      datePollId: await this.datePollFor(viewerId, ref, base.view.startsAt, isOwner),
      ...(await this.groupFor(viewerId, ref, isOwner)),
    };
  }

  /** Grupo do evento em que o visitante está (só mostra conversa de que ele já faz parte) e se ele pode criar um. */
  private async groupFor(viewerId: string, ref: EventRef, isOwner: boolean): Promise<Pick<EventPageView, 'group' | 'canCreateGroup'>> {
    const { conversations, scheduling, meetups } = this.deps;
    const candidates: string[] = [];
    if (ref.source === 'USER') {
      candidates.push(...(await conversations.groupIdsForEventPost(ref.id)));
      const poll = await scheduling.findByEventPost(ref.id);
      if (poll && poll.status !== 'CANCELLED') candidates.push(poll.conversationId);
    }
    for (const m of await meetups.listForUser(viewerId, 50)) {
      if (m.status === 'ACTIVE' && (m.eventPostId === ref.id || m.eventId === ref.id)) candidates.push(m.conversationId);
    }
    for (const id of [...new Set(candidates)]) {
      const conversation = await conversations.findById(id);
      if (conversation?.type !== 'GROUP') continue;
      if (!((await conversations.participantIds(id)) ?? []).includes(viewerId)) continue;
      return { group: { conversationId: id, name: conversation.name ?? '' }, canCreateGroup: false };
    }
    const canCreateGroup = ref.source === 'USER' && isOwner && (await this.deps.posts.findById(ref.id))?.post.archivedAt === null;
    return { group: null, canCreateGroup };
  }

  /**
   * Quem já foi convidado para o evento (marcado na criação ou que recebeu o cartão), para a folha de convidar mostrar
   * "Convidado". O dono vê todos e quem convidou cada um; os demais veem só quem eles convidaram. Evento de local não tem convites.
   */
  async invites(viewerId: string, rawId: unknown): Promise<{ invites: EventInviteView[] }> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    if (ref.source !== 'USER') return { invites: [] };
    const isOwner = owner?.userId === viewerId;
    const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    const rows = (await this.deps.posts.listInvites(ref.id)).filter((r) => (isOwner || r.invitedById === viewerId) && !hidden.has(r.userId));
    const tagged = new Map((await this.deps.posts.tagsFor([ref.id])).map((t) => [t.userId, t.status]));
    // Evento público não marca: quem confirmou "Eu vou" conta como quem aceitou (não dá mais para cancelar).
    const going = new Set((await this.deps.eventRoom.listGoing(ref)).map((g) => g.userId));
    const ids = [...new Set(rows.flatMap((r) => [r.userId, ...(r.invitedById ? [r.invitedById] : [])]))];
    const byId = new Map((await this.deps.users.findProfilesByIds(ids)).map((p) => [p.userId, toPublicProfile(p)]));
    return {
      invites: rows.flatMap((r): EventInviteView[] => {
        const user = byId.get(r.userId);
        if (!user) return [];
        return [{ user, invitedBy: r.invitedById ? (byId.get(r.invitedById) ?? null) : null, invitedAt: r.createdAt.toISOString(), tagged: tagged.has(r.userId) && tagged.get(r.userId) !== 'DECLINED', status: going.has(r.userId) ? 'ACCEPTED' : (tagged.get(r.userId) ?? 'PENDING') }];
      }),
    };
  }

  /** Votação aberta da data de um evento sem data, se quem vê é o dono ou participa dela. */
  private async datePollFor(viewerId: string, ref: EventRef, startsAt: string | null, isOwner: boolean): Promise<string | null> {
    if (ref.source !== 'USER' || startsAt !== null) return null;
    const poll = await this.deps.scheduling.findByEventPost(ref.id);
    if (!poll || poll.status === 'CANCELLED' || poll.status === 'FINALIZED') return null;
    if (isOwner) return poll.id;
    return (await this.deps.scheduling.listParticipants(poll.id)).some((p) => p.userId === viewerId) ? poll.id : null;
  }

  /**
   * Página do evento para quem não entrou: sem quem vai e sem stories, só o número de confirmados.
   * Evento de local sempre abre. Evento criado por uma pessoa abre só se for público (não privado, não arquivado) e o perfil
   * de quem criou for público e ativo; aí o dono aparece (o perfil dele já é aberto a qualquer um). Senão, "não encontrado".
   */
  async publicGet(rawId: unknown, input: { lat?: number; lng?: number } = {}): Promise<EventPageView> {
    const id = parseId(rawId);
    let ref: EventRef;
    let owner: PublicProfile | null = null;
    if (await this.deps.places.findEvent(id)) {
      ref = { source: 'PLACE', id };
    } else {
      owner = await this.publicUserEventOwner(id);
      ref = { source: 'USER', id };
    }
    const base = await this.base(VISITOR_ID, ref, input);
    const counts = await this.deps.eventRoom.countGoing([ref]);
    const going = counts.get(id) ?? 0;
    // Em evento de pessoa o dono conta como confirmado (como na página de quem entrou), mesmo sem presença gravada.
    const ownerGoing = owner ? (await this.deps.eventRoom.listGoing(ref)).some((g) => g.userId === owner.userId) : false;
    return {
      ...base.view,
      postedByMe: false,
      confirmedCount: owner && !ownerGoing ? going + 1 : going,
      going: false,
      attendees: [],
      owner,
      isOwner: false,
      storyUserIds: [],
      canStory: false,
      goingOnProfile: false,
      datePollId: null,
      group: null,
      canCreateGroup: false,
    };
  }

  /** Evento de pessoa que o visitante pode abrir: público, não arquivado, de perfil público e conta ativa. Devolve o dono. */
  private async publicUserEventOwner(id: string): Promise<PublicProfile> {
    const post = (await this.deps.posts.findById(id))?.post;
    if (!post || post.eventTitle === null || post.archivedAt !== null || post.eventPrivate) throw notFound('Evento não encontrado');
    const author = await this.deps.users.findProfileById(post.authorId);
    if (!author) throw notFound('Evento não encontrado');
    let canSee = false;
    try {
      // Mesma regra do perfil: conta suspensa some, perfil privado só abre para quem segue (o visitante não segue ninguém).
      canSee = (await this.profiles.getByUsername(VISITOR_ID, author.username)).canViewContent;
    } catch (failure) {
      if (!(failure instanceof DomainError)) throw failure;
    }
    if (!canSee) throw notFound('Evento não encontrado');
    return toPublicProfile(author);
  }

  private async base(viewerId: string, ref: EventRef, input: { lat?: number; lng?: number }): Promise<{ view: Omit<EventPageView, 'confirmedCount' | 'going' | 'attendees' | 'owner' | 'isOwner' | 'storyUserIds' | 'canStory' | 'goingOnProfile' | 'datePollId' | 'group' | 'canCreateGroup'> }> {
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
          extras: [],
        },
      };
    }
    const found = await this.deps.posts.findById(ref.id);
    const title = found?.post.eventTitle;
    const startsAt = found?.post.eventStartsAt;
    const endsAt = found?.post.eventEndsAt;
    if (!found || !title) throw notFound('Evento não encontrado');
    const { post, images } = found;
    const first = [...images].sort((a, b) => a.position - b.position)[0];
    const cover: EventCoverView | null = !first ? null : first.isUpload ? { kind: 'UPLOAD', imageId: first.id, ...(first.videoMime ? { video: true } : {}) } : first.placePhotoRef ? { kind: 'PLACE', photoRef: first.placePhotoRef, author: first.placePhotoAuthor } : null;
    // Rolê escolhido entre os locais do AskouT: a página do evento ganha o link e o ponto no mapa do local.
    const linked = post.placeVenueId ? await this.deps.places.findVenue(post.placeVenueId) : undefined;
    return {
      view: {
        id: post.id,
        source: 'USER',
        title,
        description: post.caption,
        kind: post.eventKind,
        startsAt: startsAt ? startsAt.toISOString() : null,
        endsAt: endsAt ? endsAt.toISOString() : null,
        isFree: false,
        sample: false,
        cover,
        venue: linked
          ? { id: linked.id, name: post.placeName ?? linked.name, address: post.placeAddress ?? linked.address, lat: linked.lat, lng: linked.lng }
          : { name: post.placeName ?? '', address: post.placeAddress, lat: null, lng: null },
        tags: [],
        ticketUrl: null,
        distanceM: null,
        postedByMe: await this.deps.profileEvents.hasPost(viewerId, post.id),
        isPrivate: post.eventPrivate === true,
        extras: post.eventExtras && post.eventExtras.length > 0 ? resolveEventExtras(post.eventExtras, await loadEventExtras(this.deps)) : [],
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
  /** `recentDays`: inclui também os que acabaram há até tantos dias (para vincular um post ao evento em que a pessoa foi). */
  async listMyGoing(viewerId: string, options: { recentDays?: number } = {}): Promise<GoingEventView[]> {
    const recent = Math.min(30, Math.max(0, Math.floor(options.recentDays ?? 0)));
    const now = this.deps.clock.now().getTime() - recent * 24 * 3_600_000;
    const rows = await this.deps.eventRoom.listGoingByUser(viewerId, MY_GOING_LIMIT);
    // Cada evento monta a página inteira; em paralelo (a ordem final é refeita pelo sort no fim).
    const resolved = await Promise.all(
      rows.map(async (row): Promise<GoingEventView | undefined> => {
        try {
          await this.resolve(viewerId, row.ref.id);
          const { view } = await this.base(viewerId, row.ref, {});
          // Data ainda em votação: não entra na lista de "vou" (ela é ordenada pela data).
          if (!view.startsAt || !view.endsAt || Date.parse(view.endsAt) < now) return undefined;
          return { id: view.id, source: view.source, title: view.title, startsAt: view.startsAt, endsAt: view.endsAt, venueName: view.venue.name === '' ? null : view.venue.name };
        } catch (failure) {
          if (!(failure instanceof DomainError)) throw failure;
          return undefined;
        }
      }),
    );
    const out: GoingEventView[] = resolved.filter((v): v is GoingEventView => v !== undefined);
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

  /**
   * Aba "Participou" do perfil: eventos em que a pessoa confirmou presença e escolheu não mostrar na aba Eventos.
   * Só a própria pessoa vê esta aba. Eventos que ela mesma criou não entram (já aparecem na aba Eventos).
   */
  async listAttended(viewerId: string, username: unknown, query: { limit?: unknown; offset?: unknown } = {}): Promise<AttendedEventsPage> {
    const view = await this.profiles.getByUsername(viewerId, username);
    if (!view.relationship.isSelf) throw forbidden('Só a própria pessoa vê os eventos da aba Participou');
    return this.goingPage(viewerId, viewerId, false, query);
  }

  /**
   * Presenças que a pessoa escolheu mostrar na aba Eventos do perfil. O visitante precisa poder ver o conteúdo do perfil e,
   * evento por evento, poder abrir o evento (evento privado só aparece para quem tem acesso a ele).
   */
  async listShownGoing(viewerId: string, username: unknown, query: { limit?: unknown; offset?: unknown } = {}): Promise<AttendedEventsPage> {
    const view = await this.profiles.getByUsername(viewerId, username);
    if (view.relationship.blockedByViewer) throw notFound('Usuário não encontrado');
    if (!view.canViewContent) throw forbidden('Esta conta é privada');
    return this.goingPage(viewerId, view.profile.userId, true, query);
  }

  private async goingPage(viewerId: string, ownerId: string, onProfile: boolean, query: { limit?: unknown; offset?: unknown }): Promise<AttendedEventsPage> {
    const page = parsePage(query);
    const isSelf = viewerId === ownerId;
    const rows = (await this.deps.eventRoom.listGoingByUser(ownerId, ATTENDED_SCAN_LIMIT)).filter((r) => r.onProfile === onProfile);
    const cards = await buildEventCards(this.deps, rows.map((r) => r.ref.id));
    const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    const checked = await Promise.all(
      rows.map(async (row): Promise<AttendedEventView | undefined> => {
        const card = cards.get(row.ref.id);
        // Evento da própria pessoa só entra no Participou (quando ela o tirou da aba Eventos); na aba Eventos ele já vem como post.
        if (!card || (card.ownerId === ownerId && onProfile)) return undefined;
        if (card.ownerId && card.ownerId !== viewerId && hidden.has(card.ownerId)) return undefined;
        // O visitante só vê o evento se ele mesmo poderia abri-lo (evento privado: só com acesso a ele).
        if (!isSelf) {
          try {
            await this.resolve(viewerId, row.ref.id);
          } catch (failure) {
            if (!(failure instanceof DomainError)) throw failure;
            return undefined;
          }
        }
        return { ...card, attendedAt: row.createdAt.toISOString() };
      }),
    );
    const all = checked.filter((v): v is AttendedEventView => v !== undefined).sort((a, b) => (b.startsAt ?? '9999').localeCompare(a.startsAt ?? '9999')); // sem data (em votação) vem primeiro
    return { items: all.slice(page.offset, page.offset + page.limit), total: all.length, ...page };
  }

  /**
   * Muda se a presença aparece na aba Eventos (true) ou só na aba Participou (false). Precisa ter confirmado presença.
   * Quem criou o evento já conta como confirmado: false tira o evento dela da aba Eventos e deixa só no Participou.
   */
  async setGoingOnProfile(viewerId: string, rawId: unknown, onProfile: unknown): Promise<EventPageView> {
    if (typeof onProfile !== 'boolean') throw validationError('Valor inválido', { onProfile: 'Use true ou false' });
    const { ref, owner } = await this.resolve(viewerId, rawId);
    if (owner?.userId === viewerId) {
      // O dono não tem presença gravada até escolher isso; a contagem de confirmados já ignora o dono na lista.
      if (!(await this.deps.eventRoom.addGoing(ref, viewerId, this.deps.clock.now(), onProfile))) await this.deps.eventRoom.setGoingOnProfile(ref, viewerId, onProfile);
    } else if (!(await this.deps.eventRoom.setGoingOnProfile(ref, viewerId, onProfile))) throw conflict('Confirme presença com Eu vou antes');
    return this.get(viewerId, ref.id);
  }

  /** "Eu vou". O dono já conta como confirmado: confirmar de novo não muda nada. */
  /** `onProfile`: mostrar o evento na aba Eventos do perfil (true) ou só na aba Participou, que só a pessoa vê (false, o padrão). */
  async go(viewerId: string, rawId: unknown, onProfile?: unknown): Promise<EventPageView> {
    if (onProfile !== undefined && typeof onProfile !== 'boolean') throw validationError('Valor inválido', { onProfile: 'Use true ou false' });
    const { ref, owner } = await this.resolve(viewerId, rawId);
    if (owner?.userId !== viewerId) {
      const found = ref.source === 'PLACE' ? await this.deps.places.findEvent(ref.id) : await this.deps.posts.findById(ref.id);
      if (!found) throw notFound('Evento não encontrado');
      // Depois que o evento termina não se confirma mais presença (a tela também esconde o botão).
      const endsAt = 'event' in found ? found.event.endsAt : found.post.eventEndsAt;
      if (endsAt && endsAt.getTime() <= this.deps.clock.now().getTime()) throw conflict('Esse evento já terminou');
      const added = await this.deps.eventRoom.addGoing(ref, viewerId, this.deps.clock.now(), onProfile === true);
      // Já tinha confirmado: só muda a escolha do perfil, se veio uma.
      if (!added && typeof onProfile === 'boolean') await this.deps.eventRoom.setGoingOnProfile(ref, viewerId, onProfile);
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
    if (!story || story.ref.id !== ref.id || story.expiresAt.getTime() <= this.deps.clock.now().getTime()) throw notFound('Flash não encontrado');
    if (story.userId === viewerId) throw forbidden('Este flash é seu: apague-o se não quiser mais');
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
    const liked = await this.deps.eventRoom.likedStoryIds(viewerId, rows.filter((r) => r.userId !== viewerId).map((r) => r.id));
    const views = await this.deps.eventRoom.storyViewCounts(rows.filter((r) => r.userId === viewerId).map((r) => r.id));
    const profiles = await this.deps.users.findProfilesByIds([...new Set(rows.map((r) => r.userId))]);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const groups = new Map<string, EventStoryGroupView>();
    for (const r of rows) {
      const author = byId.get(r.userId);
      if (!author) continue;
      const group = groups.get(r.userId) ?? { author, mine: r.userId === viewerId, items: [] };
      group.items.push({ id: r.id, kind: r.video ? 'VIDEO' : 'IMAGE', ...captionOf(r), createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), canDelete: r.userId === viewerId || owner?.userId === viewerId, ...(r.overlays?.length ? { overlays: r.overlays } : {}), ...(r.userId !== viewerId ? { liked: liked.has(r.id) } : { views: views.get(r.id) ?? 0 }) });
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
    const liked = await this.deps.eventRoom.likedStoryIds(viewerId, rows.filter((r) => r.userId !== viewerId).map((r) => r.id));
    const views = await this.deps.eventRoom.storyViewCounts(rows.filter((r) => r.userId === viewerId).map((r) => r.id));
    const profiles = await this.deps.users.findProfilesByIds([...new Set(rows.map((r) => r.userId))]);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    // Um evento por vez era lento (cada um monta a página inteira); em paralelo, um por referência distinta.
    const refs = new Map(rows.map((r) => [r.ref.id, r.ref] as const));
    const events = new Map<string, ProfileStoryEventView | null>(await Promise.all([...refs.values()].map(async (ref) => [ref.id, await this.eventLabel(viewerId, ref)] as const)));
    const groups = new Map<string, ProfileStoryGroupView>();
    for (const r of rows) {
      const author = byId.get(r.userId);
      if (!author) continue;
      const mine = r.userId === viewerId;
      const group = groups.get(r.userId) ?? { author, mine, items: [] };
      group.items.push({ id: r.id, kind: r.video ? 'VIDEO' : 'IMAGE', ...captionOf(r), createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), canDelete: mine, event: events.get(r.ref.id) ?? null, ...(r.overlays?.length ? { overlays: r.overlays } : {}), ...(mine ? { views: views.get(r.id) ?? 0 } : { liked: liked.has(r.id) }) });
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
    if (!visible) throw notFound('Flash não encontrado');
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
    if (actorId === otherId) throw validationError('Você não pode ocultar seus flashes de si mesmo');
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
    if (story.userId !== viewerId) throw forbidden('Só quem publicou apaga o flash por aqui');
    await this.deps.eventRoom.deleteStory(story.id);
    return { deleted: true };
  }

  /** Denuncia, pela página inicial, o story de um amigo. */
  async reportProfileStory(viewerId: string, storyId: unknown, reason: unknown, details?: unknown): Promise<{ reported: true }> {
    const story = await this.profileStoryFor(viewerId, storyId);
    if (story.userId === viewerId) throw forbidden('Este flash é seu: apague-o se não quiser mais');
    if (typeof reason !== 'string' || !(POST_REPORT_REASONS as readonly string[]).includes(reason)) throw validationError('Motivo inválido', { reason: 'Escolha um motivo da lista' });
    const text = optionalText(details, EVENT_STORY_REPORT_DETAILS_MAX, 'details', 'Detalhes');
    await this.deps.eventRoom.reportStory({ id: this.deps.ids.next(), storyId: story.id, reporterId: viewerId, reason: reason as PostReportReason, details: text, createdAt: this.deps.clock.now() });
    return { reported: true };
  }

  /**
   * O story que `viewerId` pode reagir: no ar, visível para ele e de outra pessoa.
   * Com `rawEventId`, vem da página do evento; sem, da página inicial (stories do perfil).
   */
  async reactableStory(viewerId: string, storyId: unknown, rawEventId?: unknown): Promise<{ authorId: string; eventUrl: string }> {
    let story: EventStoryMeta;
    if (rawEventId === undefined) {
      story = await this.profileStoryFor(viewerId, storyId);
    } else {
      const { ref } = await this.resolve(viewerId, rawEventId);
      const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));
      const found = typeof storyId === 'string' && storyId.length <= 64 ? (await this.visibleStories(viewerId, ref, hidden)).find((s) => s.id === storyId) : undefined;
      if (!found) throw notFound('Flash não encontrado');
      story = found;
    }
    if (story.userId === viewerId) throw forbidden('Este flash é seu');
    return { authorId: story.userId, eventUrl: `/eventos/${story.ref.id}` };
  }

  /** Publica um story. Só quem confirmou presença (ou o dono), enquanto o evento não acabou. Foto até 2 MB ou vídeo até 60 MB. */
  /** `overlays`: textos e figurinhas por cima da mídia (ver `parseStoryOverlays`). `text`: o texto único da versão anterior. */
  async createStory(viewerId: string, rawId: unknown, contentType: unknown, bytes: unknown, onProfile?: unknown, rawOverlays?: unknown, text?: { caption?: unknown; captionY?: unknown }): Promise<EventStoryGroupView> {
    const overlays = parseStoryOverlays(rawOverlays);
    const { ref, owner } = await this.resolve(viewerId, rawId);
    const isOwner = owner?.userId === viewerId;
    if (!isOwner && !(await this.deps.eventRoom.isGoing(ref, viewerId))) throw forbidden('Confirme presença para publicar um flash neste evento');
    const { view } = await this.base(viewerId, ref, {});
    const now = this.deps.clock.now();
    // Sem data (em votação): o flash dura as horas de sempre; com data, some no fim do evento.
    const endsAt = view.endsAt ? Date.parse(view.endsAt) : Number.POSITIVE_INFINITY;
    if (endsAt <= now.getTime()) throw forbidden('Esse evento já terminou');
    const mine = (await this.deps.eventRoom.listStories(ref, now)).filter((s) => s.userId === viewerId);
    if (mine.length >= EVENT_STORY_MAX_PER_USER) throw validationError('Muitos flashes', { media: `Você já tem ${EVENT_STORY_MAX_PER_USER} flashes no ar neste evento` });
    const media = parseChatMedia(contentType, bytes, POST_VIDEO_MAX_BYTES);
    const caption = parseStoryCaption(text?.caption, text?.captionY);
    const expiresAt = new Date(Math.min(now.getTime() + EVENT_STORY_HOURS * 3_600_000, endsAt));
    const record = { id: this.deps.ids.next(), ref, userId: viewerId, mime: media.mime, video: media.kind === 'VIDEO', onProfile: onProfile === true, ...caption, ...(overlays ? { overlays } : {}), data: media.data, createdAt: now, expiresAt };
    await this.deps.eventRoom.addStory(record);
    const me = await this.deps.users.findProfileById(viewerId);
    return { author: toPublicProfile(me!), mine: true, items: [{ id: record.id, kind: media.kind, ...caption, createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), canDelete: true, ...(overlays ? { overlays } : {}) }] };
  }

  async deleteStory(viewerId: string, rawId: unknown, storyId: unknown): Promise<{ deleted: true }> {
    const { ref, owner } = await this.resolve(viewerId, rawId);
    const story = typeof storyId === 'string' && storyId.length <= 64 ? await this.deps.eventRoom.findStory(storyId) : undefined;
    if (!story || story.ref.id !== ref.id) throw notFound('Flash não encontrado');
    if (story.userId !== viewerId && owner?.userId !== viewerId) throw forbidden('Só quem publicou ou o dono do evento apaga o flash');
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
