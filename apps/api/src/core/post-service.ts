import { communityForEvent, shareGroupEvent } from './community-service.ts';
import { canOpenByInvite } from './event-invites.ts';
import { canManageVenue, managedVenueIds } from './venue-access.ts';
import { decodeImageDataUrl } from './image.ts';
import { POST_VIDEO_MAX_BYTES, parseChatMedia } from './media.ts';
import { extractMentions } from './mentions.ts';
import { commentEvidence, gifOf, parseCommentGif } from './gif.ts';
import type { CommentGif } from './gif.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ProfileService } from './profile-service.ts';
import type { PollRecord, PostCommentRecord, PostPatch, PostReportReason, PostKindFilter, PostImageRecord, PostRecord, PostTagStatus, PostWithImages, PublicProfile } from './types.ts';
import type { EventKind } from './types.ts';
import { parseReportInput } from './report-input.ts';
import { buildEventCards } from './event-card.ts';
import type { EventCardView } from './event-card.ts';
import { EVENT_KINDS, POST_REPORT_REASONS, toPublicProfile } from './types.ts';
import { loadEventExtras, parseEventExtraAnswers } from './event-extras.ts';
import type { EventExtraAnswer } from './event-extras.ts';

export const POST_IMAGES_MAX = 5;
export const POST_CAPTION_MAX = 500;
/** Cada foto enviada chega já reduzida pelo app: até 100 KB. */
export const POST_IMAGE_MAX_BYTES = 100 * 1024;
export const POST_TAGS_MAX = 10;
export const POST_COMMENT_MAX = 500;
export const POST_REPORT_DETAILS_MAX = 300;
/** Duração máxima de um evento: festivais e viagens passam de 24 h. */
export const POST_EVENT_MAX_DAYS = 30;
export const POST_PAGE_DEFAULT = 12;
export const POST_PAGE_MAX = 30;

/** Uma foto do post. Enviada: data URL. Do lugar: referência da foto (já conferida pela borda HTTP). */
export type PostImageInput = string | { placePhotoRef: string; placePhotoAuthor?: string | null };

export interface PostInput {
  caption?: unknown;
  images?: unknown;
  placeName?: unknown;
  placeAddress?: unknown;
  /** Local do AskouT escolhido como rolê (o nome no post leva à página dele). */
  placeVenueId?: unknown;
  /** Evento ao qual o post fica vinculado (de um local ou criado por alguém). Post comum precisa de um evento ou de um rolê. */
  linkedEventId?: unknown;
  /** Amigos marcados (até 10). Cada um precisa aceitar para o post entrar no feed e no perfil dele. */
  tagUserIds?: unknown;
  /** Evento criado pela pessoa: `{title, startsAt, endsAt?}` (ISO), ou `{title, dateByPoll: true}` sem data (decidida numa votação). O lugar é opcional. */
  event?: unknown;
  /** Votação de datas concluída da qual este evento é consequência (só quem organizou a votação). */
  datePollId?: unknown;
  /** Evento criado dentro de um grupo de amigos (id da conversa do grupo): nasce privado e o convite vai para todos do grupo. */
  groupId?: unknown;
}

export interface PostImageView {
  id: string;
  kind: 'UPLOAD' | 'PLACE';
  /** O item é um vídeo (a imagem de capa continua valendo como foto). */
  video: boolean;
  /** Só em foto do lugar: referência para montar o endereço assinado. */
  photoRef: string | null;
  photoAuthor: string | null;
}

/** Evento ao qual um post comum está vinculado: o nome leva à página do evento. */
export interface PostLinkedEventView {
  id: string;
  source: 'PLACE' | 'USER';
  title: string;
  startsAt: string | null;
}

/** Evento lido do pedido: sem início nem fim enquanto a data espera a votação. */
type ParsedEvent = { title: string; startsAt: Date | null; endsAt: Date | null; kind: EventKind };

export interface PostEventView {
  title: string;
  kind: EventKind;
  /** Nulos quando a data ainda vai ser decidida numa votação. */
  startsAt: string | null;
  endsAt: string | null;
  /** Evento privado: só o dono e quem recebeu o cartão numa conversa. */
  private: boolean;
  /** Respostas às configurações de evento (para preencher a edição). */
  extras: EventExtraAnswer[];
}

export interface PostTagView {
  user: PublicProfile;
  status: 'PENDING' | 'ACCEPTED';
}

/** Estabelecimento em nome de quem o post foi publicado. */
export interface PostVenueView {
  id: string;
  name: string;
  /** https ou caminho da logo enviada. */
  logoUrl: string | null;
}

export interface PostView {
  id: string;
  author: PublicProfile;
  /** Preenchido quando o post é de um estabelecimento: a tela mostra o local no lugar do autor. */
  venue: PostVenueView | null;
  caption: string | null;
  placeName: string | null;
  /** Página do local quando o nome digitado bate, sem diferença de maiúscula, com um único local do AskouT; senão null. */
  placeVenueId: string | null;
  placeAddress: string | null;
  /** Preenchido quando o post é um evento. */
  event: PostEventView | null;
  /** Evento ao qual o post está vinculado (null se não há, se sumiu ou se quem vê não tem acesso). */
  linkedEvent: PostLinkedEventView | null;
  createdAt: string;
  images: PostImageView[];
  mine: boolean;
  /** Marcados: todos veem os que aceitaram; o autor e o próprio marcado também veem os pendentes. */
  tags: PostTagView[];
  /** A marcação do visitante neste post, se houver. */
  myTag: PostTagStatus | null;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
  /** Só a própria pessoa vê posts arquivados. */
  archived: boolean;
  edited: boolean;
  /** Só no Início: o evento entrou porque alguém que você segue (ou você) repostou. Mostra quem repostou e quando. */
  repostedBy?: PublicProfile;
  repostedAt?: string;
}

/** Evento de local (bar) que alguém que você segue (ou você) postou no perfil, como item do Início. */
export interface PlaceEventFeedItem {
  type: 'PLACE_EVENT';
  /** O id do evento (não colide com ids de post). */
  id: string;
  event: EventCardView;
  repostedBy: PublicProfile;
  repostedAt: string;
}

/** Item do Início: um post (com ou sem repost) ou um evento de local repostado. */
export type HomeFeedItem = PostView | PlaceEventFeedItem;

export interface HomeFeedPage extends Omit<PostsPage, 'items'> {
  items: HomeFeedItem[];
  /** Data do post mais antigo do Início (só na primeira página), para a régua de datas. */
  oldestAt?: string | null;
}

export interface PostCommentView {
  id: string;
  author: PublicProfile;
  /** Preenchido quando o comentário é do estabelecimento: a tela mostra o local no lugar do autor. */
  venue: PostVenueView | null;
  body: string;
  /** GIF anexado (Giphy), se houver. */
  gif: CommentGif | null;
  createdAt: string;
  mine: boolean;
  /** Quem escreveu e o dono do post podem apagar. */
  canDelete: boolean;
  likeCount: number;
  likedByMe: boolean;
  /** Nomes de usuário marcados com @ que existem (a tela só faz link para estes). */
  mentions: string[];
  /** Resposta: o comentário de cima da conversa. */
  parentId: string | null;
}

export interface PostCommentsPage {
  items: PostCommentView[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Edição: só o que vier (diferente de `undefined`) muda. `event: null` tira os dados de evento. */
export interface PostEditInput {
  caption?: unknown;
  placeName?: unknown;
  placeAddress?: unknown;
  /** Local do AskouT do rolê; `null` desvincula. Mudar só o nome também desvincula. */
  placeVenueId?: unknown;
  /** Evento vinculado; `null` desvincula (desde que fique um rolê). */
  linkedEventId?: unknown;
  event?: unknown;
  /** Amigos para convidar agora (só evento). Quem já foi convidado fica como está; os novos recebem o convite como na criação. */
  inviteUserIds?: unknown;
}

export interface PostsPage {
  items: PostView[];
  total: number | null;
  limit: number;
  offset: number;
  hasMore: boolean;
}

function parsePage(raw: { limit?: unknown; offset?: unknown }): { limit: number; offset: number } {
  const num = (v: unknown, def: number, min: number, max: number, field: string) => {
    if (v === undefined || v === null || v === '') return def;
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,9}$/.test(v) ? Number(v) : Number.NaN;
    if (!Number.isInteger(n) || n < min || n > max) throw validationError('Valor inválido', { [field]: `Use um inteiro entre ${min} e ${max}` });
    return n;
  };
  return { limit: num(raw.limit, POST_PAGE_DEFAULT, 1, POST_PAGE_MAX, 'limit'), offset: num(raw.offset, 0, 0, 1_000_000, 'offset') };
}

/** `kind` da lista do perfil: `event` (só eventos) ou `post` (só posts comuns); vazio traz tudo. */
function parseKind(v: unknown): PostKindFilter | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v === 'event') return 'EVENT';
  if (v === 'post') return 'POST';
  throw validationError('Valor inválido', { kind: 'Use event ou post' });
}

function optionalText(value: unknown, max: number, field: string, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError('Dados inválidos', { [field]: `${label} inválido` });
  const text = value.trim().replace(/\r\n/g, '\n');
  if (text === '') return null;
  if (Array.from(text).length > max) throw validationError('Dados inválidos', { [field]: `${label} pode ter até ${max} caracteres` });
  return text;
}

/** Posts com fotos: criar, ver, listar por perfil, feed dos amigos e apagar. */
export class PostService {
  private readonly deps: CoreDeps;
  private readonly profiles: ProfileService;

  constructor(deps: CoreDeps, profiles: ProfileService) {
    this.deps = deps;
    this.profiles = profiles;
  }

  /** Post em nome de um estabelecimento: só quem administra o local. Sem marcações nem evento próprio (eventos têm o painel do local). */
  async createForVenue(actorId: string, venueId: unknown, input: PostInput): Promise<PostView> {
    const venue = typeof venueId === 'string' && venueId !== '' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue || !(await canManageVenue(this.deps.places, actorId, venue))) throw notFound('Local não encontrado');
    if (!Array.isArray(input.images) || input.images.some((i) => typeof i !== 'string')) throw validationError('Fotos inválidas', { images: 'Envie fotos do aparelho' });
    return this.create(actorId, { caption: input.caption, images: input.images }, venue);
  }

  async create(actorId: string, input: PostInput, venue?: { id: string; name: string; address: string | null }): Promise<PostView> {
    const { posts, ids, clock } = this.deps;
    const caption = optionalText(input.caption, POST_CAPTION_MAX, 'caption', 'Legenda');
    const placeVenue = venue ? undefined : await this.placeVenue(input.placeVenueId);
    const placeName = venue ? venue.name : (optionalText(input.placeName, 120, 'placeName', 'Nome do local') ?? placeVenue?.name.slice(0, 120) ?? null);
    const placeAddress = venue ? venue.address : (optionalText(input.placeAddress, 200, 'placeAddress', 'Endereço') ?? placeVenue?.address?.slice(0, 200) ?? null);
    const event = this.parseEvent(input.event, placeName);
    // Evento no grupo de amigos: só quem está no grupo cria, e nasce privado (dá para abrir ao público depois, editando).
    const community = input.groupId === undefined || input.groupId === null || input.groupId === '' ? undefined : await communityForEvent(this.deps, actorId, input.groupId);
    if (community && (event === null || venue)) throw validationError('Só eventos são criados no grupo', { groupId: 'Crie um evento para o grupo' });
    const eventPrivate = event !== null && (community !== undefined || this.parsePrivate(input.event));
    const eventExtras = event !== null ? await this.parseExtras(input.event) : [];
    const poll = event !== null && input.datePollId !== undefined && input.datePollId !== null ? await this.pollToLink(actorId, input.datePollId) : undefined;
    // Evento criado pela pessoa já é o próprio evento; post de local já tem o local. Os demais vinculam um evento ou um rolê.
    const linkedEvent = event === null && !venue ? await this.linkableEvent(actorId, input.linkedEventId) : undefined;
    if (event === null && !venue && !linkedEvent && !placeName) {
      throw validationError('Escolha um evento ou um local', { place: 'Todo post precisa de um evento ou de um local vinculado' });
    }
    const raw = input.images === undefined || input.images === null ? [] : input.images;
    // Post comum e evento podem ficar sem foto (o evento usa a capa padrão do tipo); post de local continua com pelo menos uma.
    const minImages = venue ? 1 : 0;
    if (!Array.isArray(raw) || raw.length < minImages || raw.length > POST_IMAGES_MAX) {
      throw validationError('Fotos inválidas', { images: minImages === 0 ? `Envie até ${POST_IMAGES_MAX} fotos` : `Envie de 1 a ${POST_IMAGES_MAX} fotos` });
    }
    if (raw.length === 0 && !caption && event === null) throw validationError('Post vazio', { caption: 'Escreva algo ou escolha uma foto ou um vídeo' });
    const postId = ids.next();
    let placePhotos = 0;
    const images: PostImageRecord[] = raw.map((item: unknown, position) => {
      const id = ids.next();
      if (typeof item === 'string') {
        const decoded = decodeImageDataUrl(item, POST_IMAGE_MAX_BYTES, '100 KB');
        return { id, postId, position, mime: decoded.mime, data: new Uint8Array(decoded.bytes), placePhotoRef: null, placePhotoAuthor: null };
      }
      const place = item as { placePhotoRef?: unknown; placePhotoAuthor?: unknown } | null;
      if (!place || typeof place !== 'object' || typeof place.placePhotoRef !== 'string' || place.placePhotoRef === '' || place.placePhotoRef.length > 512) {
        throw validationError('Fotos inválidas', { images: 'Foto inválida' });
      }
      placePhotos += 1;
      const author = optionalText(place.placePhotoAuthor, 100, 'images', 'Autor da foto');
      return { id, postId, position, mime: null, data: null, placePhotoRef: place.placePhotoRef, placePhotoAuthor: author };
    });
    if (placePhotos > 1) throw validationError('Fotos inválidas', { images: 'Use só uma foto do local por post' });
    const tagIds = await this.validTags(actorId, input.tagUserIds);
    await posts.create({ id: postId, authorId: actorId, caption, placeName, placeAddress, eventTitle: event?.title ?? null, eventStartsAt: event?.startsAt ?? null, eventEndsAt: event?.endsAt ?? null, eventKind: event?.kind ?? 'OTHER', eventPrivate, eventExtras, archivedAt: null, editedAt: null, createdAt: clock.now(), venueId: venue?.id ?? null, placeVenueId: placeVenue?.id ?? null, linkedEventId: linkedEvent?.id ?? null, originGroupId: community?.id ?? null }, images);
    if (tagIds.length > 0) {
      await posts.createTags(postId, tagIds, clock.now());
      // Marcar alguém no evento já é convidar: aparece como convidado e abre o evento (mesmo privado).
      if (event) await posts.addInvites(postId, tagIds, actorId, clock.now());
      await this.notifyTagged(actorId, postId, event?.title ?? null, tagIds);
    }
    if (poll && event) await this.linkPoll(poll, postId, event.title, actorId);
    if (community && event) await shareGroupEvent(this.deps, actorId, community, { id: postId, title: event.title });
    const created = await posts.findById(postId);
    if (!created) throw notFound('Post não encontrado');
    return (await this.views(actorId, [created]))[0] as PostView;
  }

  /** A votação concluída (data definida) de quem organiza, ainda sem evento. */
  private async pollToLink(actorId: string, id: unknown): Promise<PollRecord> {
    const poll = typeof id === 'string' && id !== '' && id.length <= 64 ? await this.deps.scheduling.find(id) : undefined;
    if (!poll || poll.organizerId !== actorId) throw notFound('Votação não encontrada');
    if (poll.status !== 'FINALIZED') throw conflict('A votação ainda não tem data definida');
    if (poll.eventPostId) throw conflict('Esta votação já virou evento');
    return poll;
  }

  /** Vincula o evento à votação: mesmo nome, e quem confirmou na votação já vai confirmado no evento. */
  private async linkPoll(poll: PollRecord, postId: string, title: string, actorId: string): Promise<void> {
    const { scheduling, meetups, eventRoom, clock } = this.deps;
    await scheduling.updatePoll(poll.id, { eventPostId: postId, title });
    const meetup = poll.meetupId ? await meetups.find(poll.meetupId) : undefined;
    if (meetup) {
      await meetups.update(meetup.id, { title, eventPostId: postId });
      const going = new Set([actorId, ...meetup.participants.filter((p) => p.status === 'CONFIRMED').map((p) => p.userId)]);
      for (const userId of going) await eventRoom.addGoing({ source: 'USER', id: postId }, userId, clock.now());
    } else {
      await eventRoom.addGoing({ source: 'USER', id: postId }, actorId, clock.now());
    }
  }

  /** O nome do evento é o nome da votação (e do encontro dela). */
  private async syncPollTitle(postId: string, title: string): Promise<void> {
    const { scheduling } = this.deps;
    const poll = await scheduling.findByEventPost(postId);
    if (!poll) return;
    if (poll.title !== title) await scheduling.updatePoll(poll.id, { title });
  }

  async get(viewerId: string, postId: unknown): Promise<PostView> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    const found = await this.deps.posts.findById(postId);
    if (!found) throw notFound('Post não encontrado');
    if (found.post.archivedAt !== null && found.post.authorId !== viewerId) throw notFound('Post não encontrado');
    if (found.post.venueId === null || found.post.venueId === undefined) {
      const open = !found.post.eventPrivate && (await this.canSee(viewerId, found.post.authorId));
      if (!open && found.post.authorId !== viewerId && !(await this.openedByCard(viewerId, found.post))) throw notFound('Post não encontrado');
    }
    return (await this.views(viewerId, [found]))[0] as PostView;
  }

  /** O post, se existe e `viewerId` pode ver. Senão 404, igual a "não existe". */
  private async seeable(viewerId: string, postId: unknown): Promise<PostWithImages> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    const found = await this.deps.posts.findById(postId);
    if (!found || (found.post.archivedAt !== null && found.post.authorId !== viewerId) || (!found.post.venueId && !(!found.post.eventPrivate && (await this.canSee(viewerId, found.post.authorId))) && found.post.authorId !== viewerId && !(await this.openedByCard(viewerId, found.post)))) throw notFound('Post não encontrado');
    return found;
  }

  async like(viewerId: string, postId: unknown): Promise<{ liked: true; likeCount: number }> {
    const { post } = await this.seeable(viewerId, postId);
    await this.deps.posts.like(post.id, viewerId, this.deps.clock.now());
    if (post.authorId !== viewerId) {
      const me = await this.deps.users.findProfileById(viewerId);
      await this.deps.notifier.notify({ userId: post.authorId, type: 'POST_LIKE', title: `${me?.username ?? 'Alguém'} curtiu seu post`, body: post.caption ? post.caption.slice(0, 80) : 'Toque para ver', url: `/posts/${post.id}`, dedupeKey: `post-like:${post.id}:${viewerId}`, actorId: viewerId });
    }
    const stats = (await this.deps.posts.likeStats([post.id], viewerId))[0];
    return { liked: true, likeCount: stats?.count ?? 0 };
  }

  async unlike(viewerId: string, postId: unknown): Promise<{ liked: false; likeCount: number }> {
    const { post } = await this.seeable(viewerId, postId);
    await this.deps.posts.unlike(post.id, viewerId);
    const stats = (await this.deps.posts.likeStats([post.id], viewerId))[0];
    return { liked: false, likeCount: stats?.count ?? 0 };
  }

  async comments(viewerId: string, postId: unknown, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostCommentsPage> {
    const { post } = await this.seeable(viewerId, postId);
    const page = parsePage({ limit: query.limit ?? 20, offset: query.offset });
    const rows = await this.deps.posts.listComments(post.id, { limit: page.limit + 1, offset: page.offset });
    const hasMore = rows.length > page.limit;
    return { items: await this.commentViews(viewerId, post.authorId, rows.slice(0, page.limit)), ...page, hasMore };
  }

  /** `replyTo`: o comentário respondido. A resposta fica sempre debaixo do comentário de cima da conversa. */
  async addComment(viewerId: string, postId: unknown, body: unknown, rawGif?: unknown, replyTo?: unknown): Promise<PostCommentView> {
    const { post } = await this.seeable(viewerId, postId);
    const text = optionalText(body, POST_COMMENT_MAX, 'body', 'Comentário') ?? '';
    const gif = parseCommentGif(rawGif);
    if (!text && !gif) throw validationError('Comentário vazio', { body: 'Escreva algo para comentar' });
    let replied: PostCommentRecord | undefined;
    if (replyTo !== undefined && replyTo !== null) {
      replied = typeof replyTo === 'string' && replyTo.length <= 64 ? await this.deps.posts.findComment(replyTo) : undefined;
      if (!replied || replied.postId !== post.id || (replied.authorId !== viewerId && (await this.deps.blocks.existsEitherWay(viewerId, replied.authorId)))) throw notFound('Comentário não encontrado');
    }
    // Quem administra o bar e comenta num post do próprio bar comenta como o bar.
    let asVenue: string | null = null;
    if (post.venueId) {
      const venue = await this.deps.places.findVenue(post.venueId);
      if (venue && (await canManageVenue(this.deps.places, viewerId, venue))) asVenue = venue.id;
    }
    const record: PostCommentRecord = { id: this.deps.ids.next(), postId: post.id, authorId: viewerId, body: text, createdAt: this.deps.clock.now(), venueId: asVenue, gifId: gif?.id ?? null, gifUrl: gif?.url ?? null, parentId: replied ? (replied.parentId ?? replied.id) : null };
    await this.deps.posts.addComment(record);
    const me = await this.deps.users.findProfileById(viewerId);
    const mentioned = await this.notifyMentions(viewerId, me?.username ?? 'Alguém', post, record.id, text);
    if (replied && replied.authorId !== viewerId && !mentioned.has(replied.authorId)) {
      await this.deps.notifier.notify({ userId: replied.authorId, type: 'POST_COMMENT', title: `${me?.username ?? 'Alguém'} respondeu seu comentário`, body: text.slice(0, 80) || 'GIF', url: `/posts/${post.id}`, dedupeKey: `comment-reply:${record.id}`, actorId: viewerId });
      mentioned.add(replied.authorId);
    }
    if (post.authorId !== viewerId && !mentioned.has(post.authorId)) {
      await this.deps.notifier.notify({ userId: post.authorId, type: 'POST_COMMENT', title: `${me?.username ?? 'Alguém'} comentou no seu post`, body: text.slice(0, 80) || 'GIF', url: `/posts/${post.id}?comentarios=1`, dedupeKey: `post-comment:${record.id}`, actorId: viewerId });
    }
    return (await this.commentViews(viewerId, post.authorId, [record]))[0] as PostCommentView;
  }

  /** Avisa quem foi marcado com @, só se a pessoa pode ver o post e não há bloqueio. Devolve quem foi avisado. */
  private async notifyMentions(viewerId: string, viewerName: string, post: PostRecord, commentId: string, text: string): Promise<Set<string>> {
    const notified = new Set<string>();
    for (const username of extractMentions(text)) {
      const target = await this.deps.users.findProfileByUsername(username);
      if (!target || target.userId === viewerId) continue;
      if (await this.deps.blocks.existsEitherWay(viewerId, target.userId)) continue;
      const canOpen = post.venueId !== null && post.venueId !== undefined ? true : target.userId === post.authorId || (!post.eventPrivate && (await this.canSee(target.userId, post.authorId)));
      if (!canOpen) continue;
      await this.deps.notifier.notify({ userId: target.userId, type: 'POST_COMMENT', title: `${viewerName} mencionou você num comentário`, body: text.slice(0, 80), url: `/posts/${post.id}?comentarios=1`, dedupeKey: `comment-mention:${commentId}:${target.userId}`, actorId: viewerId });
      notified.add(target.userId);
    }
    return notified;
  }

  /** Curtir (ou, com `liked: false`, tirar a curtida de) um comentário. Curtir de novo não duplica. */
  async likeComment(viewerId: string, postId: unknown, commentId: unknown, liked = true): Promise<{ liked: boolean; likeCount: number }> {
    const { post } = await this.seeable(viewerId, postId);
    const comment = typeof commentId === 'string' && commentId.length <= 64 ? await this.deps.posts.findComment(commentId) : undefined;
    if (!comment || comment.postId !== post.id) throw notFound('Comentário não encontrado');
    if (liked) {
      await this.deps.posts.likeComment(comment.id, viewerId, this.deps.clock.now());
      if (comment.authorId !== viewerId) {
        const me = await this.deps.users.findProfileById(viewerId);
        await this.deps.notifier.notify({ userId: comment.authorId, type: 'POST_LIKE', title: `${me?.username ?? 'Alguém'} curtiu seu comentário`, body: comment.body.slice(0, 80) || 'GIF', url: `/posts/${post.id}?comentarios=1`, dedupeKey: `comment-like:${comment.id}:${viewerId}`, actorId: viewerId });
      }
    } else {
      await this.deps.posts.unlikeComment(comment.id, viewerId);
    }
    const [stat] = await this.deps.posts.commentLikeStats([comment.id], viewerId);
    return { liked: stat?.liked ?? false, likeCount: stat?.count ?? 0 };
  }

  async deleteComment(viewerId: string, postId: unknown, commentId: unknown): Promise<{ deleted: true }> {
    const { post } = await this.seeable(viewerId, postId);
    const comment = typeof commentId === 'string' && commentId.length <= 64 ? await this.deps.posts.findComment(commentId) : undefined;
    if (!comment || comment.postId !== post.id) throw notFound('Comentário não encontrado');
    if (comment.authorId !== viewerId && post.authorId !== viewerId) throw forbidden('Só quem escreveu ou o dono do post apaga o comentário');
    await this.deps.posts.deleteComment(comment.id);
    return { deleted: true };
  }

  private async commentViews(viewerId: string, postAuthorId: string, rows: PostCommentRecord[]): Promise<PostCommentView[]> {
    const profiles = await this.deps.users.findProfilesByIds([...new Set(rows.map((r) => r.authorId))]);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const memo = new Map<string, boolean>();
    const out: PostCommentView[] = [];
    const stats = new Map((await this.deps.posts.commentLikeStats(rows.map((r) => r.id), viewerId)).map((s) => [s.commentId, s] as const));
    const known = new Map<string, boolean>();
    const mentionsOf = async (text: string): Promise<string[]> => {
      const valid: string[] = [];
      for (const name of extractMentions(text)) {
        if (!known.has(name)) known.set(name, (await this.deps.users.findProfileByUsername(name)) !== undefined);
        if (known.get(name)) valid.push(name);
      }
      return valid;
    };
    const extra = async (row: PostCommentRecord) => ({ likeCount: stats.get(row.id)?.count ?? 0, likedByMe: stats.get(row.id)?.liked ?? false, mentions: await mentionsOf(row.body), parentId: row.parentId ?? null });
    const venueIds = [...new Set(rows.flatMap((r) => (r.venueId ? [r.venueId] : [])))];
    const venues = new Map((await Promise.all(venueIds.map((id) => this.deps.places.findVenue(id)))).flatMap((v) => (v ? [[v.id, { id: v.id, name: v.name, logoUrl: v.logoUrl ?? null }] as const] : [])));
    for (const row of rows) {
      const author = byId.get(row.authorId);
      if (!author) continue;
      const venue = (row.venueId ? venues.get(row.venueId) : undefined) ?? null;
      if (venue) {
        out.push({ id: row.id, author, venue, body: row.body, gif: gifOf(row), createdAt: row.createdAt.toISOString(), mine: row.authorId === viewerId, canDelete: row.authorId === viewerId || postAuthorId === viewerId, ...(await extra(row)) });
        continue;
      }
      if (!memo.has(row.authorId)) memo.set(row.authorId, row.authorId === viewerId || (await this.canSee(viewerId, row.authorId)));
      if (!memo.get(row.authorId)) continue;
      out.push({ id: row.id, author, venue: null, body: row.body, gif: gifOf(row), createdAt: row.createdAt.toISOString(), mine: row.authorId === viewerId, canDelete: row.authorId === viewerId || postAuthorId === viewerId, ...(await extra(row)) });
    }
    return out;
  }

  /** Denunciar um post de outra pessoa. Quem denuncia também deixa de ver o post. */
  async report(viewerId: string, postId: unknown, reason: unknown, details?: unknown): Promise<{ reported: true }> {
    const { post } = await this.seeable(viewerId, postId);
    if (post.authorId === viewerId) throw forbidden('Você não pode denunciar o seu próprio post');
    if (typeof reason !== 'string' || !(POST_REPORT_REASONS as readonly string[]).includes(reason)) throw validationError('Motivo inválido', { reason: 'Escolha um motivo da lista' });
    const text = optionalText(details, POST_REPORT_DETAILS_MAX, 'details', 'Detalhes');
    await this.deps.posts.report({ id: this.deps.ids.next(), postId: post.id, reporterId: viewerId, reason: reason as PostReportReason, details: text, createdAt: this.deps.clock.now() });
    await this.deps.posts.hide(post.id, viewerId);
    return { reported: true };
  }

  /** Denunciar um comentário de outra pessoa. A equipe recebe o texto como estava. */
  async reportComment(viewerId: string, postId: unknown, commentId: unknown, reason: unknown, details?: unknown): Promise<{ reported: true }> {
    const { post } = await this.seeable(viewerId, postId);
    const comment = typeof commentId === 'string' && commentId.length <= 64 ? await this.deps.posts.findComment(commentId) : undefined;
    if (!comment || comment.postId !== post.id) throw notFound('Comentário não encontrado');
    if (comment.authorId === viewerId) throw forbidden('Você não pode denunciar o seu próprio comentário');
    const input = parseReportInput(reason, details);
    await this.deps.users.addReport({ id: this.deps.ids.next(), kind: 'COMMENT', reporterId: viewerId, reportedUserId: comment.authorId, commentId: comment.id, evidence: commentEvidence(comment.body, comment.gifUrl), reason: input.reason, details: input.details, createdAt: this.deps.clock.now() });
    return { reported: true };
  }

  /** "Não tenho interesse": o post some do feed de quem pediu. */
  async notInterested(viewerId: string, postId: unknown): Promise<{ hidden: true }> {
    const { post } = await this.seeable(viewerId, postId);
    if (post.authorId === viewerId) throw forbidden('Esse é o seu post');
    await this.deps.posts.hide(post.id, viewerId);
    return { hidden: true };
  }

  async update(actorId: string, postId: unknown, input: PostEditInput): Promise<PostView> {
    const { post, images } = await this.seeable(actorId, postId);
    if (post.authorId !== actorId) throw forbidden('Só quem publicou edita o post');
    const caption = input.caption === undefined ? post.caption : optionalText(input.caption, POST_CAPTION_MAX, 'caption', 'Legenda');
    const placeName = input.placeName === undefined ? post.placeName : optionalText(input.placeName, 120, 'placeName', 'Nome do local');
    const placeAddress = input.placeAddress === undefined ? post.placeAddress : optionalText(input.placeAddress, 200, 'placeAddress', 'Endereço');
    // Escolheu outro local do AskouT: vincula. Digitou outro nome sem escolher: o vínculo antigo não vale mais.
    const placeVenueId =
      input.placeVenueId !== undefined ? ((await this.placeVenue(input.placeVenueId))?.id ?? null) : placeName === post.placeName ? (post.placeVenueId ?? null) : null;
    let event: ParsedEvent | null;
    if (input.event === undefined) {
      event = post.eventTitle ? { title: post.eventTitle, startsAt: post.eventStartsAt, endsAt: post.eventEndsAt, kind: post.eventKind } : null;
    } else {
      // Evento que ainda espera a votação continua sem data se a edição não trouxer uma.
      event = this.parseEvent(input.event, placeName, post.eventStartsAt, post.eventKind, post.eventTitle !== null && post.eventStartsAt === null);
    }
    // `event.extras` ausente mantém as respostas; virar post comum apaga.
    const rawExtras = input.event !== undefined && input.event !== null ? (input.event as { extras?: unknown }).extras : undefined;
    const eventExtras = event === null ? [] : rawExtras === undefined ? (post.eventExtras ?? []) : await this.parseExtras(input.event);
    // Evento vinculado: só em post comum. `null` desvincula; ausente mantém.
    let linkedEventId: string | null = event === null ? (post.linkedEventId ?? null) : null;
    if (event === null && input.linkedEventId !== undefined) linkedEventId = input.linkedEventId === null || input.linkedEventId === '' ? null : ((await this.linkableEvent(actorId, input.linkedEventId))?.id ?? null);
    // Quem já tinha evento ou rolê não pode ficar sem nenhum (posts antigos, de antes da regra, seguem editáveis).
    const hadLink = Boolean(post.placeName || post.linkedEventId);
    if (event === null && !post.venueId && hadLink && !placeName && !linkedEventId) {
      throw validationError('Escolha um evento ou um local', { place: 'Todo post precisa de um evento ou de um local vinculado' });
    }
    if (!caption && images.length === 0 && event === null) throw validationError('Post vazio', { caption: 'Post sem foto precisa de um texto' });
    // "Quem vê" (público ou só convidados) muda na edição quando vier; virar post comum deixa público.
    const rawPrivate = input.event !== undefined && input.event !== null ? (input.event as { private?: unknown }).private : undefined;
    const eventPrivate = event === null ? false : rawPrivate === undefined ? undefined : this.parsePrivate(input.event);
    // Convidados novos: conferidos antes de salvar, para um erro não deixar a edição pela metade.
    const inviteIds = event === null ? [] : await this.validTags(actorId, input.inviteUserIds, 'inviteUserIds');
    const patch: PostPatch = { caption, placeName, placeAddress, placeVenueId, linkedEventId, eventTitle: event?.title ?? null, eventStartsAt: event?.startsAt ?? null, eventEndsAt: event?.endsAt ?? null, eventKind: event?.kind ?? 'OTHER', eventExtras, ...(eventPrivate === undefined ? {} : { eventPrivate }), editedAt: this.deps.clock.now() };
    if (!(await this.deps.posts.update(post.id, actorId, patch))) throw notFound('Post não encontrado');
    if (event) {
      await this.syncPollTitle(post.id, event.title);
      await this.deps.meetups.renameForEventPost(post.id, event.title);
      await this.inviteFriends(actorId, post.id, event.title, inviteIds);
    }
    return this.get(actorId, post.id);
  }

  /**
   * Convidar mais amigos para o próprio evento depois de criado: como marcar na criação (convite, marcação e aviso).
   * Quem já foi convidado (na criação, pelo cartão numa conversa ou antes) não é convidado de novo nem recebe outro aviso,
   * a não ser que tenha recusado: aí o convite volta a ficar pendente e a pessoa é avisada de novo.
   */
  async inviteToEvent(actorId: string, postId: unknown, userIds: unknown): Promise<{ invited: string[] }> {
    const { post } = await this.seeable(actorId, postId);
    if (post.authorId !== actorId) throw forbidden('Só quem criou o evento convida por aqui');
    if (!post.eventTitle) throw validationError('Esse post não é um evento', { inviteUserIds: 'Só dá para convidar para um evento' });
    const ids = await this.validTags(actorId, userIds, 'inviteUserIds');
    return { invited: await this.inviteFriends(actorId, post.id, post.eventTitle, ids) };
  }

  /**
   * Desfaz um convite que ainda não foi aceito: some o convite, a marcação e o aviso no sino de quem foi convidado
   * (a pessoa pode ser convidada de novo). Cancela quem organiza o evento (qualquer convite) ou quem mandou aquele convite.
   * Quem já aceitou a marcação ou confirmou "Eu vou" não sai por aqui.
   */
  async cancelInvite(actorId: string, postId: unknown, userId: unknown): Promise<{ cancelled: true }> {
    const { post } = await this.seeable(actorId, postId);
    if (typeof userId !== 'string' || userId === '' || userId.length > 64) throw notFound('Convite não encontrado');
    const invite = (await this.deps.posts.listInvites(post.id)).find((i) => i.userId === userId);
    if (post.authorId !== actorId && invite?.invitedById !== actorId) throw forbidden('Só quem organiza o evento ou quem mandou o convite pode cancelar');
    if (!invite) throw notFound('Convite não encontrado');
    const tag = (await this.deps.posts.tagsFor([post.id])).find((t) => t.userId === userId);
    if (tag?.status === 'ACCEPTED' || (await this.deps.eventRoom.isGoing({ source: 'USER', id: post.id }, userId))) throw conflict('Essa pessoa já aceitou o convite');
    if (!(await this.deps.posts.removeInvite(post.id, userId))) throw notFound('Convite não encontrado');
    await this.deps.notifier.withdraw?.(userId, `post-tag:${post.id}`);
    return { cancelled: true };
  }

  /** Convida (sem duplicar) e, só para quem é novo, cria a marcação e avisa. Quem tinha recusado volta a ter o convite pendente. */
  private async inviteFriends(actorId: string, postId: string, eventTitle: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const now = this.deps.clock.now();
    const added = await this.deps.posts.addInvites(postId, ids, actorId, now);
    const fresh = new Set(added);
    const declined = (await this.deps.posts.tagsFor([postId])).filter((t) => t.status === 'DECLINED' && !fresh.has(t.userId) && ids.includes(t.userId)).map((t) => t.userId);
    for (const userId of declined) await this.deps.posts.respondTag(postId, userId, 'PENDING');
    if (added.length > 0) await this.deps.posts.createTags(postId, added, now);
    const invited = [...added, ...declined];
    if (invited.length > 0) await this.notifyTagged(actorId, postId, eventTitle, invited);
    return invited;
  }

  private async notifyTagged(actorId: string, postId: string, eventTitle: string | null, userIds: string[]): Promise<void> {
    const who = (await this.deps.users.findProfileById(actorId))?.username ?? 'Alguém';
    for (const userId of userIds) {
      await this.deps.notifier.notify({ userId, type: 'POST_TAG', title: eventTitle !== null ? `${who} marcou você no evento ${eventTitle}` : `${who} marcou você num post`, body: eventTitle !== null ? 'Aceite para o evento aparecer no seu perfil' : 'Aceite para ele aparecer no seu perfil', url: `/posts/${postId}`, dedupeKey: `post-tag:${postId}`, actorId });
    }
  }

  /** Ajuste (recorte) de uma foto enviada do próprio post. */
  async replaceImage(actorId: string, postId: unknown, imageId: unknown, dataUrl: unknown): Promise<PostView> {
    const { post, images } = await this.seeable(actorId, postId);
    if (post.authorId !== actorId) throw forbidden('Só quem publicou ajusta as fotos');
    const target = typeof imageId === 'string' ? images.find((i) => i.id === imageId) : undefined;
    if (!target || !target.isUpload) throw notFound('Foto não encontrada');
    const decoded = decodeImageDataUrl(dataUrl, POST_IMAGE_MAX_BYTES, '100 KB');
    if (!(await this.deps.posts.replaceImage(post.id, target.id, this.deps.ids.next(), decoded.mime, new Uint8Array(decoded.bytes)))) throw notFound('Foto não encontrada');
    return this.get(actorId, post.id);
  }

  /** Troca a capa do próprio evento por uma foto enviada (a foto do lugar ou o vídeo que era a capa saem; as outras fotos ficam). */
  async setCover(actorId: string, postId: unknown, dataUrl: unknown): Promise<PostView> {
    const { post } = await this.seeable(actorId, postId);
    if (post.authorId !== actorId) throw forbidden('Só quem criou o evento troca a capa');
    if (post.eventTitle === null) throw notFound('Evento não encontrado');
    const decoded = decodeImageDataUrl(dataUrl, POST_IMAGE_MAX_BYTES, '100 KB');
    await this.deps.posts.setCover(post.id, this.deps.ids.next(), decoded.mime, new Uint8Array(decoded.bytes));
    return this.get(actorId, post.id);
  }

  async archive(actorId: string, postId: unknown): Promise<{ archived: true }> {
    const { post } = await this.seeable(actorId, postId);
    if (!(await this.deps.posts.setArchived(post.id, actorId, this.deps.clock.now()))) throw forbidden('Só quem publicou arquiva o post');
    return { archived: true };
  }

  async unarchive(actorId: string, postId: unknown): Promise<{ archived: false }> {
    const { post } = await this.seeable(actorId, postId);
    if (!(await this.deps.posts.setArchived(post.id, actorId, null))) throw forbidden('Só quem publicou desarquiva o post');
    return { archived: false };
  }

  async listArchived(actorId: string, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostsPage> {
    const page = parsePage(query);
    const rows = await this.deps.posts.listArchived(actorId, { limit: page.limit + 1, offset: page.offset });
    const hasMore = rows.length > page.limit;
    return { items: await this.views(actorId, rows.slice(0, page.limit)), total: null, ...page, hasMore };
  }

  async delete(actorId: string, postId: unknown): Promise<{ deleted: true }> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    if (!(await this.deps.posts.delete(postId, actorId))) throw notFound('Post não encontrado');
    return { deleted: true };
  }

  /** Posts de `username`, vistos por `viewerId`. Perfil privado só para quem segue (ou o próprio). */
  async listByUsername(viewerId: string, username: unknown, query: { limit?: unknown; offset?: unknown; kind?: unknown } = {}): Promise<PostsPage> {
    const only = parseKind(query.kind);
    const view = await this.profiles.getByUsername(viewerId, username);
    if (view.relationship.blockedByViewer) throw notFound('Usuário não encontrado');
    if (!view.canViewContent) throw forbidden('Esta conta é privada');
    const page = parsePage(query);
    const { posts } = this.deps;
    const [all, count] = await Promise.all([posts.listFor([view.profile.userId], [view.profile.userId], { limit: page.limit + 1, offset: page.offset }, only), posts.countFor(view.profile.userId, only)]);
    // Aba Eventos: sem os eventos que a pessoa deixou só no Participou.
    const hidden = only === 'EVENT' ? await this.eventsOnlyAttended(view.profile.userId) : new Set<string>();
    const rows = all.filter((r) => !hidden.has(r.post.id));
    const total = Math.max(0, count - hidden.size);
    const hasMore = rows.length > page.limit;
    const visible = await this.onlySeeable(viewerId, rows.slice(0, page.limit));
    return { items: await this.views(viewerId, visible), total, ...page, hasMore };
  }

  /** Eventos criados pela pessoa que ela tirou da aba Eventos (ficam só no Participou, que só ela vê). */
  private async eventsOnlyAttended(userId: string): Promise<Set<string>> {
    const rows = await this.deps.eventRoom.listGoingByUser(userId, 500);
    const out = new Set<string>();
    for (const r of rows) {
      if (r.onProfile || r.ref.source !== 'USER') continue;
      if ((await this.deps.posts.findById(r.ref.id))?.post.authorId === userId) out.add(r.ref.id);
    }
    return out;
  }

  /**
   * Posts seus e de quem você segue (amigos ou não; perfil privado só aparece para quem já foi aceito), do mais recente ao mais antigo.
   * Eventos de pessoas repostados por você ou por quem você segue entram também, na data do repost, com quem repostou.
   * Cada post aparece uma vez só, na entrada mais recente (o post em si ou o repost mais novo).
   */
  async feed(viewerId: string, query: { limit?: unknown; offset?: unknown; before?: unknown } = {}, options: { placeEvents?: boolean } = {}): Promise<HomeFeedPage> {
    const page = parsePage(query);
    // `before`: a régua de datas pula para o que foi publicado antes deste instante; `offset` conta a partir daí.
    let before: Date | undefined;
    if (query.before !== undefined && query.before !== null && query.before !== '') {
      before = typeof query.before === 'string' && query.before.length <= 40 ? new Date(query.before) : new Date(NaN);
      if (Number.isNaN(before.getTime())) throw validationError('Data inválida', { before: 'Use uma data ISO' });
    }
    const following = await this.deps.follows.listFollowingIds(viewerId);
    // Quem administra um local vê os posts dele no próprio Início, mesmo sem segui-lo.
    const owned = await managedVenueIds(this.deps.places, viewerId);
    const venueIds = [...new Set([...(await this.deps.places.listFollowedVenueIds(viewerId)), ...owned])];
    // As listas vêm do começo até o fim desta página e são unidas aqui (mesma regra da lista de eventos do perfil).
    const want = page.offset + page.limit + 1;
    const people = [viewerId, ...following];
    const [rows, reposts, placeReposts] = await Promise.all([
      this.deps.posts.listFor(people, [viewerId], { limit: want, offset: 0 }, undefined, { hideFor: viewerId, venueIds, before }),
      this.deps.profileEvents.listPostReposts(people, want, before),
      options.placeEvents ? this.deps.profileEvents.listPlaceReposts(people, want, before) : Promise.resolve([]),
    ]);
    type Entry = { key: string; id: string; at: number; place?: boolean; row?: PostWithImages; by?: string };
    const entries: Entry[] = [
      ...rows.map((row): Entry => ({ key: `p:${row.post.id}`, id: row.post.id, at: row.post.createdAt.getTime(), row })),
      ...reposts.map((r): Entry => ({ key: `p:${r.postId}`, id: r.postId, at: r.createdAt.getTime(), by: r.userId })),
      ...placeReposts.map((r): Entry => ({ key: `e:${r.eventId}`, id: r.eventId, at: r.createdAt.getTime(), by: r.userId, place: true })),
    ].sort((x, y) => y.at - x.at || (x.key < y.key ? 1 : x.key > y.key ? -1 : 0));
    // Cada post ou evento aparece uma vez só, na entrada mais recente.
    const seen = new Set<string>();
    const merged = entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
    const hasMore = rows.length >= want || reposts.length >= want || placeReposts.length >= want || merged.length > page.offset + page.limit;
    const slice = merged.slice(page.offset, page.offset + page.limit);

    // Repostados ainda não carregados: o post precisa existir, ser um evento, não estar arquivado nem escondido por quem vê.
    const missing = slice.filter((e) => !e.row && !e.place).map((e) => e.id);
    const hidden = new Set(await this.deps.posts.hiddenAmong(viewerId, missing));
    const loaded = new Map<string, PostWithImages>();
    for (const id of missing) {
      if (hidden.has(id)) continue;
      const found = await this.deps.posts.findById(id);
      if (found && found.post.eventTitle && found.post.archivedAt === null) loaded.set(id, found);
    }
    const postEntries = slice.flatMap((e) => {
      if (e.place) return [];
      const row = e.row ?? loaded.get(e.id);
      return row ? [{ row, entry: e }] : [];
    });
    const visible = new Set((await this.onlySeeable(viewerId, postEntries.map((o) => o.row))).map((r) => r.post.id));
    // Quem repostou também precisa estar visível para quem vê (perfil privado só para seguidor aceito).
    const reposterIds = [...new Set(slice.flatMap((e) => (e.by ? [e.by] : [])))];
    const reposterOk = new Map<string, boolean>();
    for (const by of reposterIds) reposterOk.set(by, await this.canSee(viewerId, by));
    const reposters = new Map((await this.deps.users.findProfilesByIds(reposterIds)).map((p) => [p.userId, toPublicProfile(p)]));
    const views = new Map((await this.views(viewerId, postEntries.filter((o) => visible.has(o.row.post.id)).map((o) => o.row))).map((v) => [v.id, v]));
    const cards = await buildEventCards(this.deps, slice.filter((e) => e.place).map((e) => e.id));
    const items = slice.flatMap((e): HomeFeedItem[] => {
      const by = e.by && reposterOk.get(e.by) ? reposters.get(e.by) : undefined;
      if (e.by && !by) return [];
      const at = new Date(e.at).toISOString();
      if (e.place) {
        const card = cards.get(e.id);
        // Só eventos de local (o de pessoa vem como post); o que sumiu fica de fora.
        if (!card || card.userEvent || !by) return [];
        return [{ type: 'PLACE_EVENT', id: e.id, event: card, repostedBy: by, repostedAt: at }];
      }
      const view = views.get(e.id);
      if (!view) return [];
      return [by ? { ...view, repostedBy: by, repostedAt: at } : view];
    });
    if (page.offset > 0 || before) return { items, total: null, ...page, hasMore };
    const oldest = await this.deps.posts.oldestFor(people, [viewerId], { hideFor: viewerId, venueIds });
    return { items, total: null, ...page, hasMore, oldestAt: oldest ? oldest.toISOString() : null };
  }

  /** Posts publicados em nome de um estabelecimento, abertos a qualquer pessoa. */
  async listByVenue(viewerId: string, venueId: unknown, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostsPage> {
    const venue = typeof venueId === 'string' && venueId !== '' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue) throw notFound('Local não encontrado');
    const page = parsePage(query);
    const rows = await this.deps.posts.listFor([], [], { limit: page.limit + 1, offset: page.offset }, undefined, { hideFor: viewerId, venueIds: [venue.id] });
    const hasMore = rows.length > page.limit;
    return { items: await this.views(viewerId, rows.slice(0, page.limit)), total: null, ...page, hasMore };
  }

  /** Posts em que você foi marcado e ainda não respondeu. */
  async pendingTags(viewerId: string, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostsPage> {
    const page = parsePage(query);
    const rows = await this.deps.posts.listPendingTags(viewerId, { limit: page.limit + 1, offset: page.offset });
    const hasMore = rows.length > page.limit;
    const visible = await this.onlySeeable(viewerId, rows.slice(0, page.limit));
    return { items: await this.views(viewerId, visible), total: null, ...page, hasMore };
  }

  /** Aceitar ou recusar (ou desfazer) a sua marcação num post. */
  async respondTag(viewerId: string, postId: unknown, action: unknown): Promise<{ status: PostTagStatus }> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    if (action !== 'accept' && action !== 'decline') throw validationError('Ação inválida', { action: 'Use accept ou decline' });
    const status: PostTagStatus = action === 'accept' ? 'ACCEPTED' : 'DECLINED';
    if (!(await this.deps.posts.respondTag(postId, viewerId, status))) throw notFound('Marcação não encontrada');
    return { status };
  }

  /**
   * Vídeo do post (até 60 MB; a duração, até 3 minutos, o app confere antes de enviar). Entra num item de foto enviada, que serve de capa.
   * Só o autor, e no máximo um vídeo por post.
   */
  async attachVideo(actorId: string, postId: unknown, imageId: unknown, mime: unknown, bytes: unknown): Promise<PostView> {
    const { post, images } = await this.seeable(actorId, postId);
    if (post.authorId !== actorId) throw forbidden('Só quem publicou anexa vídeo');
    const target = typeof imageId === 'string' ? images.find((i) => i.id === imageId) : undefined;
    if (!target || !target.isUpload) throw notFound('Item não encontrado');
    if (images.some((i) => i.videoMime)) throw conflict('Este post já tem um vídeo');
    const media = parseChatMedia(mime, bytes, POST_VIDEO_MAX_BYTES);
    if (media.kind !== 'VIDEO') throw validationError('Envie um vídeo (MP4, WebM ou MOV)', { media: 'Envie um vídeo (MP4, WebM ou MOV)' });
    if (!(await this.deps.posts.attachVideo(post.id, target.id, media.mime, media.data))) throw notFound('Item não encontrado');
    return this.get(actorId, post.id);
  }

  /** Vídeo enviado, para o <video>. Quem tem o endereço (id aleatório) vê, como na foto. */
  async video(imageId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof imageId !== 'string' || imageId === '' || imageId.length > 64) return undefined;
    return this.deps.posts.findVideo(imageId);
  }

  /** Foto enviada, para o <img>. Quem tem o endereço (id aleatório) vê, como na foto de perfil. */
  async image(imageId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof imageId !== 'string' || imageId === '' || imageId.length > 64) return undefined;
    return this.deps.posts.findImage(imageId);
  }

  /** Evento: título, início de até 2 anos atrás a até 2 anos à frente, fim opcional (padrão: 3 h depois; no máximo 30 dias). O lugar é opcional. */
  /** Local do AskouT escolhido como rolê. Id que não existe (ou apagado) só não vincula: o nome digitado continua valendo. */
  private async placeVenue(raw: unknown): Promise<{ id: string; name: string; address: string | null } | undefined> {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string' || raw.length > 64) throw validationError('Local inválido', { placeVenueId: 'Local inválido' });
    const venue = await this.deps.places.findVenue(raw);
    return venue ? { id: venue.id, name: venue.name, address: venue.address } : undefined;
  }

  /** Evento que a pessoa pode vincular ao post: de um local, ou criado por alguém cujo conteúdo ela vê (privado, só por cartão). */
  private async linkableEvent(actorId: string, raw: unknown): Promise<{ id: string } | undefined> {
    if (raw === undefined || raw === null || raw === '') return undefined;
    const invalid = () => validationError('Evento inválido', { linkedEventId: 'Evento não encontrado' });
    if (typeof raw !== 'string' || raw.length > 64) throw invalid();
    if (await this.deps.places.findEvent(raw)) return { id: raw };
    const found = await this.deps.posts.findById(raw);
    const post = found?.post;
    if (!post || post.eventTitle === null) throw invalid();
    if (post.authorId === actorId) return { id: post.id };
    if (post.archivedAt !== null) throw invalid();
    if (await this.deps.blocks.existsEitherWay(actorId, post.authorId)) throw invalid();
    const visible = !post.eventPrivate && (await this.canSee(actorId, post.authorId));
    if (!visible && !(await this.openedByCard(actorId, post))) throw invalid();
    return { id: post.id };
  }

  /** Nome e data dos eventos vinculados, para quem vê. Evento privado só aparece para o dono e para quem recebeu o cartão. */
  private async linkedEvents(viewerId: string, ids: string[]): Promise<Map<string, PostLinkedEventView>> {
    const out = new Map<string, PostLinkedEventView>();
    for (const id of ids) {
      const place = await this.deps.places.findEvent(id);
      if (place) {
        out.set(id, { id, source: 'PLACE', title: place.event.title, startsAt: place.event.startsAt.toISOString() });
        continue;
      }
      const post = (await this.deps.posts.findById(id))?.post;
      if (!post || post.eventTitle === null) continue;
      if (post.authorId !== viewerId) {
        if (post.archivedAt !== null) continue;
        if (post.eventPrivate && !(await this.openedByCard(viewerId, post))) continue;
      }
      out.set(id, { id, source: 'USER', title: post.eventTitle, startsAt: post.eventStartsAt ? post.eventStartsAt.toISOString() : null });
    }
    return out;
  }

  /** `keepUndated`: editando um evento que ainda espera a votação, sem data nova continua sem data. */
  private parseEvent(raw: unknown, placeName: string | null, keepStart?: Date | null, keepKind?: EventKind, keepUndated = false): ParsedEvent | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw validationError('Evento inválido', { event: 'Dados do evento inválidos' });
    const e = raw as { title?: unknown; startsAt?: unknown; endsAt?: unknown; kind?: unknown; dateByPoll?: unknown };
    let kind: EventKind = keepKind ?? 'OTHER';
    if (e.kind !== undefined && e.kind !== null) {
      if (typeof e.kind !== 'string' || !(EVENT_KINDS as readonly string[]).includes(e.kind)) throw validationError('Evento inválido', { event: 'Tipo de evento inválido' });
      kind = e.kind as EventKind;
    }
    const title = optionalText(e.title, 120, 'event', 'Título do evento');
    if (!title) throw validationError('Evento inválido', { event: 'Dê um nome ao evento' });
    const date = (v: unknown, label: string): Date => {
      const d = typeof v === 'string' && v.length <= 40 ? new Date(v) : new Date(Number.NaN);
      if (Number.isNaN(d.getTime())) throw validationError('Evento inválido', { event: `${label} inválido` });
      return d;
    };
    // Sem data só quando ela vai ser decidida numa votação (pedido explícito, ou o evento já estava assim).
    const noStart = e.startsAt === undefined || e.startsAt === null || e.startsAt === '';
    if (noStart && (e.dateByPoll === true || keepUndated)) return { title, startsAt: null, endsAt: null, kind };
    if (e.dateByPoll !== undefined && typeof e.dateByPoll !== 'boolean') throw validationError('Evento inválido', { event: 'Use true ou false em dateByPoll' });
    const now = this.deps.clock.now().getTime();
    const startsAt = date(e.startsAt, 'Início');
    // Data no passado vale (registrar um rolê que já rolou), até 2 anos atrás; quem mantém o início de antes nunca esbarra nisso.
    const unchanged = keepStart !== undefined && keepStart !== null && keepStart.getTime() === startsAt.getTime();
    if (!unchanged && startsAt.getTime() < now - 2 * 365 * 24 * 3_600_000) throw validationError('Evento inválido', { event: 'Início antigo demais' });
    if (startsAt.getTime() > now + 2 * 365 * 24 * 3_600_000) throw validationError('Evento inválido', { event: 'Início distante demais' });
    const endsAt = e.endsAt === undefined || e.endsAt === null || e.endsAt === '' ? new Date(startsAt.getTime() + 3 * 3_600_000) : date(e.endsAt, 'Fim');
    if (endsAt.getTime() <= startsAt.getTime()) throw validationError('Evento inválido', { event: 'O fim precisa ser depois do início' });
    if (endsAt.getTime() - startsAt.getTime() > POST_EVENT_MAX_DAYS * 24 * 3_600_000) throw validationError('Evento inválido', { event: `O evento pode durar até ${POST_EVENT_MAX_DAYS} dias` });
    return { title, startsAt, endsAt, kind };
  }

  /** `event.private` só vale ao criar: true marca o evento como privado. */
  private parsePrivate(raw: unknown): boolean {
    const value = (raw as { private?: unknown }).private;
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') throw validationError('Evento inválido', { event: 'Privado precisa ser sim ou não' });
    return value;
  }

  /** `event.extras`: respostas às configurações de evento cadastradas pela gestão. */
  private async parseExtras(raw: unknown): Promise<EventExtraAnswer[]> {
    const value = (raw as { extras?: unknown }).extras;
    if (value === undefined || value === null) return [];
    return parseEventExtraAnswers(value, await loadEventExtras(this.deps));
  }

  /** Quem foi convidado para o evento (marcado ou recebeu o cartão numa conversa) abre o post, mesmo sem seguir o dono. */
  private async openedByCard(viewerId: string, post: { id: string; eventTitle?: string | null }): Promise<boolean> {
    return post.eventTitle ? canOpenByInvite(this.deps, viewerId, post.id) : false;
  }

  private async validTags(actorId: string, raw: unknown, field: 'tagUserIds' | 'inviteUserIds' = 'tagUserIds'): Promise<string[]> {
    if (raw === undefined || raw === null) return [];
    const tagging = field === 'tagUserIds';
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string') || raw.length > POST_TAGS_MAX) {
      throw validationError(tagging ? 'Marcações inválidas' : 'Convites inválidos', { [field]: tagging ? `Marque até ${POST_TAGS_MAX} amigos` : `Convide até ${POST_TAGS_MAX} amigos por vez` });
    }
    const ids = [...new Set(raw as string[])].filter((id) => id !== actorId);
    if (ids.length === 0) return [];
    const friends = new Set(await this.deps.follows.listFriendIds(actorId));
    if (ids.some((id) => !friends.has(id))) {
      throw validationError(tagging ? 'Marcações inválidas' : 'Convites inválidos', { [field]: tagging ? 'Só dá para marcar amigos (quem segue você e que você segue)' : 'Só dá para convidar amigos (quem segue você e que você segue)' });
    }
    return ids;
  }

  /** Posts de outras pessoas só entram numa lista se quem vê também pode ver o autor. */
  /** Dos ids dados, os posts que `viewerId` pode ver (existem, não estão arquivados, perfil e evento visíveis). Sem montar a tela. */
  async visibleIds(viewerId: string, ids: string[]): Promise<Set<string>> {
    const rows: PostWithImages[] = [];
    for (const id of new Set(ids)) {
      const found = await this.deps.posts.findById(id);
      if (found && found.post.archivedAt === null) rows.push(found);
    }
    return new Set((await this.onlySeeable(viewerId, rows)).map((r) => r.post.id));
  }

  /** Posts pelos ids (na mesma ordem), só os que `viewerId` pode ver e que não estão arquivados. Usado nas recomendações. */
  async viewsByIds(viewerId: string, ids: string[]): Promise<PostView[]> {
    const rows: PostWithImages[] = [];
    for (const id of ids) {
      const found = await this.deps.posts.findById(id);
      if (found && found.post.archivedAt === null) rows.push(found);
    }
    return this.views(viewerId, await this.onlySeeable(viewerId, rows));
  }

  private async onlySeeable(viewerId: string, rows: PostWithImages[]): Promise<PostWithImages[]> {
    const memo = new Map<string, boolean>();
    const out: PostWithImages[] = [];
    for (const row of rows) {
      if (row.post.venueId) {
        out.push(row);
        continue;
      }
      const author = row.post.authorId;
      // Evento privado não aparece em listas (feed, perfil) de ninguém além do dono.
      if (row.post.eventPrivate && author !== viewerId) continue;
      if (!memo.has(author)) memo.set(author, await this.canSee(viewerId, author));
      if (memo.get(author)) out.push(row);
    }
    return out;
  }

  private async canSee(viewerId: string, authorId: string): Promise<boolean> {
    if (viewerId === authorId) return true;
    const author = await this.deps.users.findProfileById(authorId);
    if (!author) return false;
    try {
      return (await this.profiles.getByUsername(viewerId, author.username)).canViewContent;
    } catch {
      return false;
    }
  }

  private async views(viewerId: string, rows: PostWithImages[]): Promise<PostView[]> {
    const authors = await this.deps.users.findProfilesByIds([...new Set(rows.map((r) => r.post.authorId))]);
    const tagRows = await this.deps.posts.tagsFor(rows.map((r) => r.post.id));
    const tagged = await this.deps.users.findProfilesByIds([...new Set(tagRows.map((t) => t.userId))]);
    const taggedById = new Map(tagged.map((a) => [a.userId, toPublicProfile(a)]));
    const byId = new Map(authors.map((a) => [a.userId, toPublicProfile(a)]));
    const venueIds = [...new Set(rows.flatMap((r) => (r.post.venueId ? [r.post.venueId] : [])))];
    const venues = new Map((await Promise.all(venueIds.map((id) => this.deps.places.findVenue(id)))).flatMap((v) => (v ? [[v.id, { id: v.id, name: v.name, logoUrl: v.logoUrl ?? null }] as const] : [])));
    // Post de pessoa com "rolê" digitado: se o nome é de um único local do AskouT, o nome leva à página dele.
    const typedNames = [...new Set(rows.flatMap((r) => (!r.post.venueId && !r.post.placeVenueId && r.post.placeName ? [r.post.placeName.trim().toLowerCase()] : [])))];
    const placeVenues = new Map<string, string>();
    for (const name of typedNames) {
      if (name === '') continue;
      const found = (await this.deps.places.searchVenues(name, undefined, 0, 10)).filter((m) => m.venue.name.trim().toLowerCase() === name);
      if (found.length === 1) placeVenues.set(name, found[0]!.venue.id);
    }
    const ids = rows.map((r) => r.post.id);
    const likes = new Map((await this.deps.posts.likeStats(ids, viewerId)).map((l) => [l.postId, l]));
    const comments = new Map((await this.deps.posts.commentCounts(ids)).map((c) => [c.postId, c.count]));
    const linked = await this.linkedEvents(viewerId, [...new Set(rows.flatMap((r) => (r.post.linkedEventId && !r.post.eventTitle ? [r.post.linkedEventId] : [])))]);
    return rows.flatMap(({ post, images }) => {
      const author = byId.get(post.authorId);
      if (!author) return [];
      return [
        {
          id: post.id,
          author,
          venue: (post.venueId ? venues.get(post.venueId) : undefined) ?? null,
          caption: post.caption,
          placeName: post.placeName,
          placeVenueId: post.venueId ? post.venueId : post.placeVenueId ? post.placeVenueId : post.placeName ? (placeVenues.get(post.placeName.trim().toLowerCase()) ?? null) : null,
          placeAddress: post.placeAddress,
          event: post.eventTitle ? { title: post.eventTitle, kind: post.eventKind, startsAt: post.eventStartsAt ? post.eventStartsAt.toISOString() : null, endsAt: post.eventEndsAt ? post.eventEndsAt.toISOString() : null, private: post.eventPrivate === true, extras: post.eventExtras ?? [] } : null,
          linkedEvent: (post.linkedEventId && !post.eventTitle ? linked.get(post.linkedEventId) : undefined) ?? null,
          createdAt: post.createdAt.toISOString(),
          mine: post.authorId === viewerId,
          likeCount: likes.get(post.id)?.count ?? 0,
          likedByMe: likes.get(post.id)?.liked ?? false,
          commentCount: comments.get(post.id) ?? 0,
          archived: post.archivedAt !== null,
          edited: post.editedAt !== null,
          myTag: tagRows.find((t) => t.postId === post.id && t.userId === viewerId)?.status ?? null,
          tags: tagRows.flatMap((t): PostTagView[] => {
            if (t.postId !== post.id || t.status === 'DECLINED') return [];
            if (t.status === 'PENDING' && post.authorId !== viewerId && t.userId !== viewerId) return [];
            const user = taggedById.get(t.userId);
            return user ? [{ user, status: t.status }] : [];
          }),
          images: [...images]
            .sort((a, b) => a.position - b.position)
            .map((i): PostImageView => ({ id: i.id, kind: i.isUpload ? 'UPLOAD' : 'PLACE', photoRef: i.placePhotoRef, photoAuthor: i.placePhotoAuthor, video: Boolean(i.videoMime) })),
        },
      ];
    });
  }
}
