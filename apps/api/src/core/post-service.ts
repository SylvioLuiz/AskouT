import { decodeImageDataUrl } from './image.ts';
import { forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ProfileService } from './profile-service.ts';
import type { PostCommentRecord, PostPatch, PostReportReason, PostKindFilter, PostImageRecord, PostTagStatus, PostWithImages, PublicProfile } from './types.ts';
import { POST_REPORT_REASONS, toPublicProfile } from './types.ts';

export const POST_IMAGES_MAX = 5;
export const POST_CAPTION_MAX = 500;
/** Cada foto enviada chega já reduzida pelo app: até 100 KB. */
export const POST_IMAGE_MAX_BYTES = 100 * 1024;
export const POST_TAGS_MAX = 10;
export const POST_COMMENT_MAX = 500;
export const POST_REPORT_DETAILS_MAX = 300;
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
  /** Evento criado pela pessoa: `{title, startsAt, endsAt?}` (ISO). Pede o nome do lugar. */
  event?: unknown;
}

export interface PostImageView {
  id: string;
  kind: 'UPLOAD' | 'PLACE';
  /** Só em foto do lugar: referência para montar o endereço assinado. */
  photoRef: string | null;
  photoAuthor: string | null;
}

export interface PostEventView {
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface PostTagView {
  user: PublicProfile;
  status: 'PENDING' | 'ACCEPTED';
}

export interface PostView {
  id: string;
  author: PublicProfile;
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
  body: string;
  createdAt: string;
  mine: boolean;
  /** Quem escreveu e o dono do post podem apagar. */
  canDelete: boolean;
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

  async create(actorId: string, input: PostInput): Promise<PostView> {
    const { posts, ids, clock } = this.deps;
    const caption = optionalText(input.caption, POST_CAPTION_MAX, 'caption', 'Legenda');
    const placeName = optionalText(input.placeName, 120, 'placeName', 'Nome do lugar');
    const placeAddress = optionalText(input.placeAddress, 200, 'placeAddress', 'Endereço');
    const event = this.parseEvent(input.event, placeName);
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
    await posts.create({ id: postId, authorId: actorId, caption, placeName, placeAddress, eventTitle: event?.title ?? null, eventStartsAt: event?.startsAt ?? null, eventEndsAt: event?.endsAt ?? null, archivedAt: null, editedAt: null, createdAt: clock.now() }, images);
    if (tagIds.length > 0) {
      await posts.createTags(postId, tagIds, clock.now());
      const me = await this.deps.users.findProfileById(actorId);
      for (const userId of tagIds) {
        await this.deps.notifier.notify({ userId, type: 'POST_TAG', title: `${me?.username ?? 'Alguém'} marcou você num post`, body: 'Aceite para ele aparecer no seu perfil', url: '/atividades', dedupeKey: `post-tag:${postId}` });
      }
    }
    const created = await posts.findById(postId);
    if (!created) throw notFound('Post não encontrado');
    return (await this.views(actorId, [created]))[0] as PostView;
  }

  async get(viewerId: string, postId: unknown): Promise<PostView> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    const found = await this.deps.posts.findById(postId);
    if (!found) throw notFound('Post não encontrado');
    if (found.post.archivedAt !== null && found.post.authorId !== viewerId) throw notFound('Post não encontrado');
    if (!(await this.canSee(viewerId, found.post.authorId))) throw notFound('Post não encontrado');
    return (await this.views(viewerId, [found]))[0] as PostView;
  }

  /** O post, se existe e `viewerId` pode ver. Senão 404, igual a "não existe". */
  private async seeable(viewerId: string, postId: unknown): Promise<PostWithImages> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    const found = await this.deps.posts.findById(postId);
    if (!found || (found.post.archivedAt !== null && found.post.authorId !== viewerId) || !(await this.canSee(viewerId, found.post.authorId))) throw notFound('Post não encontrado');
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
    const record: PostCommentRecord = { id: this.deps.ids.next(), postId: post.id, authorId: viewerId, body: text, createdAt: this.deps.clock.now() };
    await this.deps.posts.addComment(record);
    if (post.authorId !== viewerId) {
      const me = await this.deps.users.findProfileById(viewerId);
      await this.deps.notifier.notify({ userId: post.authorId, type: 'POST_COMMENT', title: `${me?.username ?? 'Alguém'} comentou no seu post`, body: text.slice(0, 80), url: `/posts/${post.id}`, dedupeKey: `post-comment:${record.id}` });
    }
    return (await this.commentViews(viewerId, post.authorId, [record]))[0] as PostCommentView;
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
    for (const row of rows) {
      const author = byId.get(row.authorId);
      if (!author) continue;
      if (!memo.has(row.authorId)) memo.set(row.authorId, row.authorId === viewerId || (await this.canSee(viewerId, row.authorId)));
      if (!memo.get(row.authorId)) continue;
      out.push({ id: row.id, author, body: row.body, createdAt: row.createdAt.toISOString(), mine: row.authorId === viewerId, canDelete: row.authorId === viewerId || postAuthorId === viewerId });
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
    let event: { title: string; startsAt: Date; endsAt: Date } | null;
    if (input.event === undefined) {
      event = post.eventTitle && post.eventStartsAt && post.eventEndsAt ? { title: post.eventTitle, startsAt: post.eventStartsAt, endsAt: post.eventEndsAt } : null;
      if (event && !placeName) throw validationError('Evento inválido', { event: 'Um evento precisa de um lugar' });
    } else {
      event = this.parseEvent(input.event, placeName, post.eventStartsAt);
    }
    const patch: PostPatch = { caption, placeName, placeAddress, eventTitle: event?.title ?? null, eventStartsAt: event?.startsAt ?? null, eventEndsAt: event?.endsAt ?? null, editedAt: this.deps.clock.now() };
    if (!(await this.deps.posts.update(post.id, actorId, patch))) throw notFound('Post não encontrado');
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
    const rows = await this.deps.posts.listFor([viewerId, ...friends], [viewerId], { limit: page.limit + 1, offset: page.offset }, undefined, { hideFor: viewerId });
    const hasMore = rows.length > page.limit;
    const visible = await this.onlySeeable(viewerId, rows.slice(0, page.limit));
    return { items: await this.views(viewerId, visible), total: null, ...page, hasMore };
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

  /** Foto enviada, para o <img>. Quem tem o endereço (id aleatório) vê, como na foto de perfil. */
  async image(imageId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof imageId !== 'string' || imageId === '' || imageId.length > 64) return undefined;
    return this.deps.posts.findImage(imageId);
  }

  /** Evento: título, início no futuro (até 2 anos), fim opcional (padrão: 3 h depois; no máximo 24 h) e lugar obrigatório. */
  private parseEvent(raw: unknown, placeName: string | null, keepStart?: Date | null): { title: string; startsAt: Date; endsAt: Date } | null {
    if (raw === undefined || raw === null) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) throw validationError('Evento inválido', { event: 'Dados do evento inválidos' });
    const e = raw as { title?: unknown; startsAt?: unknown; endsAt?: unknown };
    const title = optionalText(e.title, 120, 'event', 'Título do evento');
    if (!title) throw validationError('Evento inválido', { event: 'Dê um nome ao evento' });
    if (!placeName) throw validationError('Evento inválido', { event: 'Escolha o lugar do evento' });
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
    if (endsAt.getTime() - startsAt.getTime() > 24 * 3_600_000) throw validationError('Evento inválido', { event: 'O evento pode durar até 24 horas' });
    return { title, startsAt, endsAt };
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
      const author = row.post.authorId;
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
          caption: post.caption,
          placeName: post.placeName,
          placeAddress: post.placeAddress,
          event: post.eventTitle && post.eventStartsAt && post.eventEndsAt ? { title: post.eventTitle, startsAt: post.eventStartsAt.toISOString(), endsAt: post.eventEndsAt.toISOString() } : null,
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
            .map((i): PostImageView => ({ id: i.id, kind: i.isUpload ? 'UPLOAD' : 'PLACE', photoRef: i.placePhotoRef, photoAuthor: i.placePhotoAuthor })),
        },
      ];
    });
  }
}
