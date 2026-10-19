import { decodeImageDataUrl } from './image.ts';
import { POST_VIDEO_MAX_BYTES, parseChatMedia } from './media.ts';
import { extractMentions } from './mentions.ts';
import { conflict, forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ProfileService } from './profile-service.ts';
import type { PollRecord, PostCommentRecord, PostPatch, PostReportReason, PostKindFilter, PostImageRecord, PostRecord, PostTagStatus, PostWithImages, PublicProfile } from './types.ts';
import type { EventKind } from './types.ts';
import { EVENT_KINDS, POST_REPORT_REASONS, toPublicProfile } from './types.ts';

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
  /** Amigos marcados (até 10). Cada um precisa aceitar para o post entrar no feed e no perfil dele. */
  tagUserIds?: unknown;
  /** Evento criado pela pessoa: `{title, startsAt, endsAt?}` (ISO). O lugar é opcional. */
  event?: unknown;
  /** Votação de datas concluída da qual este evento é consequência (só quem organizou a votação). */
  datePollId?: unknown;
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

export interface PostEventView {
  title: string;
  kind: EventKind;
  startsAt: string;
  endsAt: string;
  /** Evento privado: só o dono e quem recebeu o cartão numa conversa. */
  private: boolean;
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
  placeAddress: string | null;
  /** Preenchido quando o post é um evento. */
  event: PostEventView | null;
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
}

export interface PostCommentView {
  id: string;
  author: PublicProfile;
  /** Preenchido quando o comentário é do estabelecimento: a tela mostra o local no lugar do autor. */
  venue: PostVenueView | null;
  body: string;
  createdAt: string;
  mine: boolean;
  /** Quem escreveu e o dono do post podem apagar. */
  canDelete: boolean;
  likeCount: number;
  likedByMe: boolean;
  /** Nomes de usuário marcados com @ que existem (a tela só faz link para estes). */
  mentions: string[];
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
  event?: unknown;
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
    if (!venue || venue.ownerId !== actorId) throw notFound('Local não encontrado');
    if (!Array.isArray(input.images) || input.images.some((i) => typeof i !== 'string')) throw validationError('Fotos inválidas', { images: 'Envie fotos do aparelho' });
    return this.create(actorId, { caption: input.caption, images: input.images }, venue);
  }

  async create(actorId: string, input: PostInput, venue?: { id: string; name: string; address: string | null }): Promise<PostView> {
    const { posts, ids, clock } = this.deps;
    const caption = optionalText(input.caption, POST_CAPTION_MAX, 'caption', 'Legenda');
    const placeName = venue ? venue.name : optionalText(input.placeName, 120, 'placeName', 'Nome do lugar');
    const placeAddress = venue ? venue.address : optionalText(input.placeAddress, 200, 'placeAddress', 'Endereço');
    const event = this.parseEvent(input.event, placeName);
    const eventPrivate = event !== null && this.parsePrivate(input.event);
    const poll = event !== null && input.datePollId !== undefined && input.datePollId !== null ? await this.pollToLink(actorId, input.datePollId) : undefined;
    const raw = input.images;
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > POST_IMAGES_MAX) {
      throw validationError('Fotos inválidas', { images: `Envie de 1 a ${POST_IMAGES_MAX} fotos` });
    }
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
    if (placePhotos > 1) throw validationError('Fotos inválidas', { images: 'Use só uma foto do lugar por post' });
    const tagIds = await this.validTags(actorId, input.tagUserIds);
    await posts.create({ id: postId, authorId: actorId, caption, placeName, placeAddress, eventTitle: event?.title ?? null, eventStartsAt: event?.startsAt ?? null, eventEndsAt: event?.endsAt ?? null, eventKind: event?.kind ?? 'OTHER', eventPostsPublic: false, eventPrivate, archivedAt: null, editedAt: null, createdAt: clock.now(), venueId: venue?.id ?? null }, images);
    if (tagIds.length > 0) {
      await posts.createTags(postId, tagIds, clock.now());
      const me = await this.deps.users.findProfileById(actorId);
      for (const userId of tagIds) {
        await this.deps.notifier.notify({ userId, type: 'POST_TAG', title: `${me?.username ?? 'Alguém'} marcou você num post`, body: 'Aceite para ele aparecer no seu perfil', url: '/atividades', dedupeKey: `post-tag:${postId}` });
      }
    }
    if (poll && event) await this.linkPoll(poll, postId, event.title, actorId);
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
      await this.deps.notifier.notify({ userId: post.authorId, type: 'POST_LIKE', title: `${me?.username ?? 'Alguém'} curtiu seu post`, body: post.caption ? post.caption.slice(0, 80) : 'Toque para ver', url: `/posts/${post.id}`, dedupeKey: `post-like:${post.id}:${viewerId}` });
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

  async addComment(viewerId: string, postId: unknown, body: unknown): Promise<PostCommentView> {
    const { post } = await this.seeable(viewerId, postId);
    const text = optionalText(body, POST_COMMENT_MAX, 'body', 'Comentário');
    if (!text) throw validationError('Comentário vazio', { body: 'Escreva algo para comentar' });
    // Quem administra o bar e comenta num post do próprio bar comenta como o bar.
    let asVenue: string | null = null;
    if (post.venueId) {
      const venue = await this.deps.places.findVenue(post.venueId);
      if (venue && venue.ownerId === viewerId) asVenue = venue.id;
    }
    const record: PostCommentRecord = { id: this.deps.ids.next(), postId: post.id, authorId: viewerId, body: text, createdAt: this.deps.clock.now(), venueId: asVenue };
    await this.deps.posts.addComment(record);
    const me = await this.deps.users.findProfileById(viewerId);
    const mentioned = await this.notifyMentions(viewerId, me?.username ?? 'Alguém', post, record.id, text);
    if (post.authorId !== viewerId && !mentioned.has(post.authorId)) {
      await this.deps.notifier.notify({ userId: post.authorId, type: 'POST_COMMENT', title: `${me?.username ?? 'Alguém'} comentou no seu post`, body: text.slice(0, 80), url: `/posts/${post.id}`, dedupeKey: `post-comment:${record.id}` });
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
      await this.deps.notifier.notify({ userId: target.userId, type: 'POST_COMMENT', title: `${viewerName} mencionou você num comentário`, body: text.slice(0, 80), url: `/posts/${post.id}`, dedupeKey: `comment-mention:${commentId}:${target.userId}` });
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
        await this.deps.notifier.notify({ userId: comment.authorId, type: 'POST_LIKE', title: `${me?.username ?? 'Alguém'} curtiu seu comentário`, body: comment.body.slice(0, 80), url: `/posts/${post.id}`, dedupeKey: `comment-like:${comment.id}:${viewerId}` });
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
    const extra = async (row: PostCommentRecord) => ({ likeCount: stats.get(row.id)?.count ?? 0, likedByMe: stats.get(row.id)?.liked ?? false, mentions: await mentionsOf(row.body) });
    const venueIds = [...new Set(rows.flatMap((r) => (r.venueId ? [r.venueId] : [])))];
    const venues = new Map((await Promise.all(venueIds.map((id) => this.deps.places.findVenue(id)))).flatMap((v) => (v ? [[v.id, { id: v.id, name: v.name, logoUrl: v.logoUrl ?? null }] as const] : [])));
    for (const row of rows) {
      const author = byId.get(row.authorId);
      if (!author) continue;
      const venue = (row.venueId ? venues.get(row.venueId) : undefined) ?? null;
      if (venue) {
        out.push({ id: row.id, author, venue, body: row.body, createdAt: row.createdAt.toISOString(), mine: row.authorId === viewerId, canDelete: row.authorId === viewerId || postAuthorId === viewerId, ...(await extra(row)) });
        continue;
      }
      if (!memo.has(row.authorId)) memo.set(row.authorId, row.authorId === viewerId || (await this.canSee(viewerId, row.authorId)));
      if (!memo.get(row.authorId)) continue;
      out.push({ id: row.id, author, venue: null, body: row.body, createdAt: row.createdAt.toISOString(), mine: row.authorId === viewerId, canDelete: row.authorId === viewerId || postAuthorId === viewerId, ...(await extra(row)) });
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

  /** "Não tenho interesse": o post some do feed de quem pediu. */
  async notInterested(viewerId: string, postId: unknown): Promise<{ hidden: true }> {
    const { post } = await this.seeable(viewerId, postId);
    if (post.authorId === viewerId) throw forbidden('Esse é o seu post');
    await this.deps.posts.hide(post.id, viewerId);
    return { hidden: true };
  }

  async update(actorId: string, postId: unknown, input: PostEditInput): Promise<PostView> {
    const { post } = await this.seeable(actorId, postId);
    if (post.authorId !== actorId) throw forbidden('Só quem publicou edita o post');
    const caption = input.caption === undefined ? post.caption : optionalText(input.caption, POST_CAPTION_MAX, 'caption', 'Legenda');
    const placeName = input.placeName === undefined ? post.placeName : optionalText(input.placeName, 120, 'placeName', 'Nome do lugar');
    const placeAddress = input.placeAddress === undefined ? post.placeAddress : optionalText(input.placeAddress, 200, 'placeAddress', 'Endereço');
    let event: { title: string; startsAt: Date; endsAt: Date; kind: EventKind } | null;
    if (input.event === undefined) {
      event = post.eventTitle && post.eventStartsAt && post.eventEndsAt ? { title: post.eventTitle, startsAt: post.eventStartsAt, endsAt: post.eventEndsAt, kind: post.eventKind } : null;
    } else {
      event = this.parseEvent(input.event, placeName, post.eventStartsAt, post.eventKind);
    }
    const patch: PostPatch = { caption, placeName, placeAddress, eventTitle: event?.title ?? null, eventStartsAt: event?.startsAt ?? null, eventEndsAt: event?.endsAt ?? null, eventKind: event?.kind ?? 'OTHER', editedAt: this.deps.clock.now() };
    if (!(await this.deps.posts.update(post.id, actorId, patch))) throw notFound('Post não encontrado');
    if (event) {
      await this.syncPollTitle(post.id, event.title);
      await this.deps.meetups.renameForEventPost(post.id, event.title);
    }
    return this.get(actorId, post.id);
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
    const [rows, total] = await Promise.all([posts.listFor([view.profile.userId], [view.profile.userId], { limit: page.limit + 1, offset: page.offset }, only), posts.countFor(view.profile.userId, only)]);
    const hasMore = rows.length > page.limit;
    const visible = await this.onlySeeable(viewerId, rows.slice(0, page.limit));
    return { items: await this.views(viewerId, visible), total, ...page, hasMore };
  }

  /** Posts seus e dos seus amigos (quem segue você e que você segue), do mais recente ao mais antigo. */
  async feed(viewerId: string, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostsPage> {
    const page = parsePage(query);
    const friends = await this.deps.follows.listFriendIds(viewerId);
    const venueIds = await this.deps.places.listFollowedVenueIds(viewerId);
    const rows = await this.deps.posts.listFor([viewerId, ...friends], [viewerId], { limit: page.limit + 1, offset: page.offset }, undefined, { hideFor: viewerId, venueIds });
    const hasMore = rows.length > page.limit;
    const visible = await this.onlySeeable(viewerId, rows.slice(0, page.limit));
    return { items: await this.views(viewerId, visible), total: null, ...page, hasMore };
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

  /** Evento: título, início no futuro (até 2 anos), fim opcional (padrão: 3 h depois; no máximo 30 dias). O lugar é opcional. */
  private parseEvent(raw: unknown, placeName: string | null, keepStart?: Date | null, keepKind?: EventKind): { title: string; startsAt: Date; endsAt: Date; kind: EventKind } | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw validationError('Evento inválido', { event: 'Dados do evento inválidos' });
    const e = raw as { title?: unknown; startsAt?: unknown; endsAt?: unknown; kind?: unknown };
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
    const now = this.deps.clock.now().getTime();
    const startsAt = date(e.startsAt, 'Início');
    const unchanged = keepStart !== undefined && keepStart !== null && keepStart.getTime() === startsAt.getTime();
    if (!unchanged && startsAt.getTime() < now - 5 * 60_000) throw validationError('Evento inválido', { event: 'O início precisa ser no futuro' });
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

  /** Quem recebeu o cartão do evento numa conversa abre o post, mesmo sem seguir o dono. */
  private async openedByCard(viewerId: string, post: { id: string; eventTitle?: string | null }): Promise<boolean> {
    return post.eventTitle ? this.deps.conversations.hasPostEventAccess(viewerId, post.id) : false;
  }

  private async validTags(actorId: string, raw: unknown): Promise<string[]> {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string') || raw.length > POST_TAGS_MAX) {
      throw validationError('Marcações inválidas', { tagUserIds: `Marque até ${POST_TAGS_MAX} amigos` });
    }
    const ids = [...new Set(raw as string[])].filter((id) => id !== actorId);
    if (ids.length === 0) return [];
    const friends = new Set(await this.deps.follows.listFriendIds(actorId));
    if (ids.some((id) => !friends.has(id))) throw validationError('Marcações inválidas', { tagUserIds: 'Só dá para marcar amigos (quem segue você e que você segue)' });
    return ids;
  }

  /** Posts de outras pessoas só entram numa lista se quem vê também pode ver o autor. */
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
    const ids = rows.map((r) => r.post.id);
    const likes = new Map((await this.deps.posts.likeStats(ids, viewerId)).map((l) => [l.postId, l]));
    const comments = new Map((await this.deps.posts.commentCounts(ids)).map((c) => [c.postId, c.count]));
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
          placeAddress: post.placeAddress,
          event: post.eventTitle && post.eventStartsAt && post.eventEndsAt ? { title: post.eventTitle, kind: post.eventKind, startsAt: post.eventStartsAt.toISOString(), endsAt: post.eventEndsAt.toISOString(), private: post.eventPrivate === true } : null,
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
