import { decodeImageDataUrl } from './image.ts';
import { forbidden, notFound, validationError } from './errors.ts';
import type { CoreDeps } from './ports.ts';
import type { ProfileService } from './profile-service.ts';
import type { PostImageRecord, PostWithImages, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

export const POST_IMAGES_MAX = 5;
export const POST_CAPTION_MAX = 500;
/** Cada foto enviada chega já reduzida pelo app: até 100 KB. */
export const POST_IMAGE_MAX_BYTES = 100 * 1024;
export const POST_PAGE_DEFAULT = 12;
export const POST_PAGE_MAX = 30;

/** Uma foto do post. Enviada: data URL. Do lugar: referência da foto (já conferida pela borda HTTP). */
export type PostImageInput = string | { placePhotoRef: string; placePhotoAuthor?: string | null };

export interface PostInput {
  caption?: unknown;
  images?: unknown;
  placeName?: unknown;
  placeAddress?: unknown;
}

export interface PostImageView {
  id: string;
  kind: 'UPLOAD' | 'PLACE';
  /** Só em foto do lugar: referência para montar o endereço assinado. */
  photoRef: string | null;
  photoAuthor: string | null;
}

export interface PostView {
  id: string;
  author: PublicProfile;
  caption: string | null;
  placeName: string | null;
  placeAddress: string | null;
  createdAt: string;
  images: PostImageView[];
  mine: boolean;
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
    await posts.create({ id: postId, authorId: actorId, caption, placeName, placeAddress, createdAt: clock.now() }, images);
    const created = await posts.findById(postId);
    if (!created) throw notFound('Post não encontrado');
    return (await this.views(actorId, [created]))[0] as PostView;
  }

  async get(viewerId: string, postId: unknown): Promise<PostView> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    const found = await this.deps.posts.findById(postId);
    if (!found) throw notFound('Post não encontrado');
    if (!(await this.canSee(viewerId, found.post.authorId))) throw notFound('Post não encontrado');
    return (await this.views(viewerId, [found]))[0] as PostView;
  }

  async delete(actorId: string, postId: unknown): Promise<{ deleted: true }> {
    if (typeof postId !== 'string' || postId === '' || postId.length > 64) throw notFound('Post não encontrado');
    if (!(await this.deps.posts.delete(postId, actorId))) throw notFound('Post não encontrado');
    return { deleted: true };
  }

  /** Posts de `username`, vistos por `viewerId`. Perfil privado só para quem segue (ou o próprio). */
  async listByUsername(viewerId: string, username: unknown, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostsPage> {
    const view = await this.profiles.getByUsername(viewerId, username);
    if (view.relationship.blockedByViewer) throw notFound('Usuário não encontrado');
    if (!view.canViewContent) throw forbidden('Esta conta é privada');
    const page = parsePage(query);
    const { posts } = this.deps;
    const [rows, total] = await Promise.all([posts.listByAuthors([view.profile.userId], { limit: page.limit + 1, offset: page.offset }), posts.countByAuthor(view.profile.userId)]);
    const hasMore = rows.length > page.limit;
    return { items: await this.views(viewerId, rows.slice(0, page.limit)), total, ...page, hasMore };
  }

  /** Posts seus e dos seus amigos (quem segue você e que você segue), do mais recente ao mais antigo. */
  async feed(viewerId: string, query: { limit?: unknown; offset?: unknown } = {}): Promise<PostsPage> {
    const page = parsePage(query);
    const friends = await this.deps.follows.listFriendIds(viewerId);
    const rows = await this.deps.posts.listByAuthors([viewerId, ...friends], { limit: page.limit + 1, offset: page.offset });
    const hasMore = rows.length > page.limit;
    return { items: await this.views(viewerId, rows.slice(0, page.limit)), total: null, ...page, hasMore };
  }

  /** Foto enviada, para o <img>. Quem tem o endereço (id aleatório) vê, como na foto de perfil. */
  async image(imageId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    if (typeof imageId !== 'string' || imageId === '' || imageId.length > 64) return undefined;
    return this.deps.posts.findImage(imageId);
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
    const byId = new Map(authors.map((a) => [a.userId, toPublicProfile(a)]));
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
          createdAt: post.createdAt.toISOString(),
          mine: post.authorId === viewerId,
          images: [...images]
            .sort((a, b) => a.position - b.position)
            .map((i): PostImageView => ({ id: i.id, kind: i.isUpload ? 'UPLOAD' : 'PLACE', photoRef: i.placePhotoRef, photoAuthor: i.placePhotoAuthor })),
        },
      ];
    });
  }
}
