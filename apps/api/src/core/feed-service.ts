import { isEmoji } from './conversation-service.ts';
import { DomainError, forbidden, notFound, validationError } from './errors.ts';
import type { EventPageService } from './event-page-service.ts';
import { decodeImageDataUrl } from './image.ts';
import { extractMentions } from './mentions.ts';
import type { CoreDeps } from './ports.ts';
import type { FeedCommentRecord, FeedCursor, FeedImageInput, FeedPolicy, FeedPostKind, FeedPostRecord, FeedPostWithImages, FeedReactionStats, FeedTarget, PublicProfile } from './types.ts';
import { toPublicProfile } from './types.ts';

/** Texto de uma publicação do feed (foto com legenda ou aviso). */
export const FEED_BODY_MAX = 1000;
export const FEED_COMMENT_MAX = 500;
/** Fotos por publicação, cada uma já reduzida pelo app (até 100 KB, como nos posts). */
export const FEED_IMAGES_MAX = 5;
export const FEED_IMAGE_MAX_BYTES = 100 * 1024;
export const FEED_PAGE_DEFAULT = 10;
export const FEED_PAGE_MAX = 30;
export const FEED_COMMENTS_PAGE_DEFAULT = 20;
export const FEED_COMMENTS_PAGE_MAX = 50;
/** Quantas publicações pendentes o dono vê de uma vez. */
export const FEED_PENDING_MAX = 50;
/** Até quantas pessoas um aviso do dono avisa (quem vai ao evento ou ligou o sininho do rolê). */
export const FEED_NOTICE_FANOUT_MAX = 500;
export const FEED_POLICIES: readonly FeedPolicy[] = ['OPEN', 'MODERATED', 'OWNER_ONLY'];

/** Onde o feed fica, do jeito que o app chama: a página de um evento ou a de um rolê. */
export type FeedPlace = 'event' | 'venue';

export interface FeedVenueView {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface FeedReactionsView {
  counts: { emoji: string; count: number }[];
  mine: string | null;
}

export interface FeedPostView {
  id: string;
  kind: FeedPostKind;
  body: string | null;
  status: 'PUBLISHED' | 'PENDING';
  createdAt: string;
  author: PublicProfile;
  /** Publicado pelo dono do rolê: a tela mostra o rolê (logo e nome) no lugar da pessoa. */
  venue: FeedVenueView | null;
  imageIds: string[];
  mine: boolean;
  /** Quem escreveu e quem modera apagam. */
  canDelete: boolean;
  /** Quem modera aprova ou recusa (só nas pendentes). */
  canModerate: boolean;
  reactions: FeedReactionsView;
  commentCount: number;
  /** Nomes de usuário marcados com @ que existem (a tela só faz link para estes). */
  mentions: string[];
}

export interface FeedCommentView {
  id: string;
  postId: string;
  author: PublicProfile;
  body: string;
  createdAt: string;
  mine: boolean;
  canDelete: boolean;
  reactions: FeedReactionsView;
  mentions: string[];
}

export interface FeedSettingsView {
  policy: FeedPolicy;
  /** Há quem modere (o dono). Rolê sem dono e evento de local sem dono ainda não têm feed aberto. */
  hasModerator: boolean;
  isModerator: boolean;
  canPost: boolean;
  /** O que eu publicar só aparece depois que o dono aprovar. */
  needsApproval: boolean;
  /** Só para quem modera: quantas esperam aprovação. */
  pendingCount: number;
}

export interface FeedPageView extends FeedSettingsView {
  items: FeedPostView[];
  /** As minhas que esperam aprovação (só na primeira página). */
  myPending: FeedPostView[];
  nextCursor: string | null;
}

export interface FeedCommentsPage {
  items: FeedCommentView[];
  nextCursor: string | null;
}

export interface FeedPostInput {
  kind?: unknown;
  body?: unknown;
  /** Data URLs das fotos, já reduzidas pelo app. */
  images?: unknown;
}

/** O alvo resolvido para quem vê: quem modera, o local (para publicar como o rolê) e o caminho da página. */
interface Ctx {
  target: FeedTarget;
  moderatorId: string | null;
  venue: FeedVenueView | null;
  title: string;
  url: string;
}

function encodeCursor(c: { createdAt: Date; id: string }): string {
  return `${c.createdAt.getTime()}_${c.id}`;
}

function decodeCursor(raw: unknown): FeedCursor | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const m = typeof raw === 'string' ? /^(\d{1,15})_([0-9a-z-]{1,64})$/i.exec(raw) : null;
  if (!m) throw validationError('Dados inválidos', { cursor: 'Posição inválida' });
  return { createdAt: new Date(Number(m[1])), id: m[2]! };
}

function pageSize(raw: unknown, def: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) throw validationError('Dados inválidos', { limit: `Use de 1 a ${max}` });
  return n;
}

function text(value: unknown, max: number, field: string, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw validationError('Dados inválidos', { [field]: `${label} inválido` });
  const out = value.trim().replace(/\r\n/g, '\n');
  if (out === '') return null;
  if (Array.from(out).length > max) throw validationError('Dados inválidos', { [field]: `${label} pode ter até ${max} caracteres` });
  return out;
}

function shortId(id: unknown): string | undefined {
  return typeof id === 'string' && id !== '' && id.length <= 64 ? id : undefined;
}

function snippet(value: string | null, fallback: string): string {
  return value ? Array.from(value).slice(0, 80).join('') : fallback;
}

/**
 * Feed das páginas de evento e de rolê: publicações com fotos ou avisos, regra de quem publica escolhida pelo dono
 * (todos, todos com aprovação, ou só o dono), comentários com @menções e reações com emoji.
 */
export class FeedService {
  private readonly deps: CoreDeps;
  private readonly events: EventPageService;

  constructor(deps: CoreDeps, events: EventPageService) {
    this.deps = deps;
    this.events = events;
  }

  // ---------- Alvo e permissões ----------

  private async venueView(venueId: string): Promise<FeedVenueView | null> {
    const v = await this.deps.places.findVenue(venueId);
    return v ? { id: v.id, name: v.name, logoUrl: v.logoUrl ?? null } : null;
  }

  /** Resolve a página para quem vê; evento que a pessoa não pode abrir dá "não encontrado". */
  private async ctx(viewerId: string, place: unknown, rawId: unknown): Promise<Ctx> {
    if (place === 'event') {
      const { ref, moderatorId, title } = await this.events.access(viewerId, rawId);
      if (ref.source === 'PLACE') {
        const found = await this.deps.places.findEvent(ref.id);
        const venue = found ? await this.venueView(found.venue.id) : null;
        return { target: { type: 'PLACE_EVENT', id: ref.id }, moderatorId, venue, title, url: `/eventos/${ref.id}` };
      }
      return { target: { type: 'USER_EVENT', id: ref.id }, moderatorId, venue: null, title, url: `/eventos/${ref.id}` };
    }
    if (place === 'venue') {
      const id = shortId(rawId);
      const venue = id ? await this.deps.places.findVenue(id) : undefined;
      if (!venue) throw notFound('Local não encontrado');
      return { target: { type: 'VENUE', id: venue.id }, moderatorId: venue.ownerId ?? null, venue: { id: venue.id, name: venue.name, logoUrl: venue.logoUrl ?? null }, title: venue.name, url: `/bares/${venue.id}` };
    }
    throw notFound('Página não encontrada');
  }

  private ctxOfTarget(viewerId: string, target: FeedTarget): Promise<Ctx> {
    return this.ctx(viewerId, target.type === 'VENUE' ? 'venue' : 'event', target.id);
  }

  /** A publicação e a sua página, se quem vê pode abri-la. Pendente só aparece para quem escreveu e quem modera. */
  private async postFor(viewerId: string, postId: unknown): Promise<{ found: FeedPostWithImages; ctx: Ctx }> {
    const id = shortId(postId);
    const found = id ? await this.deps.feed.findPost(id) : undefined;
    if (!found) throw notFound('Publicação não encontrada');
    let ctx: Ctx;
    try {
      ctx = await this.ctxOfTarget(viewerId, found.post.target);
    } catch (failure) {
      if (failure instanceof DomainError) throw notFound('Publicação não encontrada');
      throw failure;
    }
    const { post } = found;
    if (post.authorId !== viewerId && (await this.deps.blocks.existsEitherWay(viewerId, post.authorId))) throw notFound('Publicação não encontrada');
    if (post.status === 'PENDING' && post.authorId !== viewerId && ctx.moderatorId !== viewerId) throw notFound('Publicação não encontrada');
    return { found, ctx };
  }

  private async settings(viewerId: string, ctx: Ctx): Promise<FeedSettingsView> {
    const policy = await this.deps.feed.getPolicy(ctx.target);
    const isModerator = ctx.moderatorId !== null && ctx.moderatorId === viewerId;
    const hasModerator = ctx.moderatorId !== null;
    const canPost = isModerator || (hasModerator && policy !== 'OWNER_ONLY');
    return {
      policy,
      hasModerator,
      isModerator,
      canPost,
      needsApproval: canPost && !isModerator && policy === 'MODERATED',
      pendingCount: isModerator ? await this.deps.feed.countPosts(ctx.target, 'PENDING') : 0,
    };
  }

  // ---------- Leitura ----------

  /** O feed da página: publicadas, da mais nova para a mais antiga, em páginas (rolagem infinita). */
  async list(viewerId: string, place: unknown, rawId: unknown, query: { cursor?: unknown; limit?: unknown } = {}): Promise<FeedPageView> {
    const ctx = await this.ctx(viewerId, place, rawId);
    const before = decodeCursor(query.cursor);
    const limit = pageSize(query.limit, FEED_PAGE_DEFAULT, FEED_PAGE_MAX);
    const rows = await this.deps.feed.listPosts(ctx.target, { status: 'PUBLISHED', limit: limit + 1, ...(before ? { before } : {}) });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const settings = await this.settings(viewerId, ctx);
    let myPending: FeedPostView[] = [];
    if (!before && settings.needsApproval) {
      const pending = (await this.deps.feed.listPosts(ctx.target, { status: 'PENDING', limit: FEED_PENDING_MAX })).filter((r) => r.post.authorId === viewerId);
      myPending = await this.views(viewerId, ctx, pending);
    }
    return {
      ...settings,
      items: await this.views(viewerId, ctx, page),
      myPending,
      nextCursor: rows.length > limit && last ? encodeCursor(last.post) : null,
    };
  }

  /** Só quem modera: as publicações que esperam aprovação, da mais antiga para a mais nova. */
  async pending(viewerId: string, place: unknown, rawId: unknown): Promise<{ items: FeedPostView[] }> {
    const ctx = await this.ctx(viewerId, place, rawId);
    if (ctx.moderatorId !== viewerId) throw forbidden('Só quem organiza vê as publicações pendentes');
    const rows = await this.deps.feed.listPosts(ctx.target, { status: 'PENDING', limit: FEED_PENDING_MAX });
    return { items: (await this.views(viewerId, ctx, rows)).reverse() };
  }

  async get(viewerId: string, postId: unknown): Promise<FeedPostView> {
    const { found, ctx } = await this.postFor(viewerId, postId);
    return (await this.views(viewerId, ctx, [found]))[0]!;
  }

  private async mentionsOf(texts: string[]): Promise<Map<string, string[]>> {
    const known = new Map<string, boolean>();
    const out = new Map<string, string[]>();
    for (const t of texts) {
      if (out.has(t)) continue;
      const valid: string[] = [];
      for (const name of extractMentions(t)) {
        if (!known.has(name)) known.set(name, (await this.deps.users.findProfileByUsername(name)) !== undefined);
        if (known.get(name)) valid.push(name);
      }
      out.set(t, valid);
    }
    return out;
  }

  private static reactions(stats: FeedReactionStats | undefined): FeedReactionsView {
    return { counts: stats?.counts ?? [], mine: stats?.mine ?? null };
  }

  /** Monta as publicações para quem vê, sem as de quem tem bloqueio com ele. */
  private async views(viewerId: string, ctx: Ctx, rows: FeedPostWithImages[]): Promise<FeedPostView[]> {
    const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    const visible = rows.filter((r) => r.post.authorId === viewerId || !hidden.has(r.post.authorId));
    if (visible.length === 0) return [];
    const ids = visible.map((r) => r.post.id);
    const [profiles, stats, counts, mentions] = await Promise.all([
      this.deps.users.findProfilesByIds([...new Set(visible.map((r) => r.post.authorId))]),
      this.deps.feed.reactionStats(ids, viewerId),
      this.deps.feed.commentCounts(ids),
      this.mentionsOf(visible.flatMap((r) => (r.post.body ? [r.post.body] : []))),
    ]);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const statsById = new Map(stats.map((s) => [s.id, s]));
    const isModerator = ctx.moderatorId === viewerId;
    return visible.flatMap(({ post, imageIds }) => {
      const author = byId.get(post.authorId);
      if (!author) return [];
      const mine = post.authorId === viewerId;
      return [
        {
          id: post.id,
          kind: post.kind,
          body: post.body,
          status: post.status,
          createdAt: post.createdAt.toISOString(),
          author,
          venue: post.asVenue ? ctx.venue : null,
          imageIds,
          mine,
          canDelete: mine || isModerator,
          canModerate: isModerator && post.status === 'PENDING',
          reactions: FeedService.reactions(statsById.get(post.id)),
          commentCount: counts.get(post.id) ?? 0,
          mentions: post.body ? (mentions.get(post.body) ?? []) : [],
        },
      ];
    });
  }

  // ---------- Publicar e moderar ----------

  /** Muda quem pode publicar. Só quem modera. */
  async setPolicy(viewerId: string, place: unknown, rawId: unknown, policy: unknown): Promise<FeedSettingsView> {
    const ctx = await this.ctx(viewerId, place, rawId);
    if (ctx.moderatorId !== viewerId) throw forbidden('Só quem organiza muda quem pode publicar');
    if (typeof policy !== 'string' || !(FEED_POLICIES as readonly string[]).includes(policy)) throw validationError('Dados inválidos', { policy: 'Escolha OPEN, MODERATED ou OWNER_ONLY' });
    if (!(await this.deps.feed.setPolicy(ctx.target, policy as FeedPolicy))) throw notFound('Página não encontrada');
    return this.settings(viewerId, ctx);
  }

  async create(viewerId: string, place: unknown, rawId: unknown, input: FeedPostInput): Promise<FeedPostView> {
    const ctx = await this.ctx(viewerId, place, rawId);
    const settings = await this.settings(viewerId, ctx);
    if (!settings.canPost) throw forbidden(settings.hasModerator ? 'Aqui só quem organiza publica' : 'Esta página ainda não tem responsável, então o feed está fechado');
    const kind: FeedPostKind = input.kind === undefined || input.kind === null || input.kind === 'POST' ? 'POST' : input.kind === 'NOTICE' ? 'NOTICE' : (() => {
      throw validationError('Dados inválidos', { kind: 'Use POST ou NOTICE' });
    })();
    const body = text(input.body, FEED_BODY_MAX, 'body', 'Texto');
    const raw = input.images === undefined || input.images === null ? [] : input.images;
    if (!Array.isArray(raw) || raw.length > FEED_IMAGES_MAX) throw validationError('Fotos inválidas', { images: `Envie até ${FEED_IMAGES_MAX} fotos` });
    const images: FeedImageInput[] = raw.map((item) => {
      const decoded = decodeImageDataUrl(item, FEED_IMAGE_MAX_BYTES, '100 KB');
      return { id: this.deps.ids.next(), mime: decoded.mime, data: new Uint8Array(decoded.bytes) };
    });
    if (!body && images.length === 0) throw validationError('Publicação vazia', { body: 'Escreva algo ou escolha uma foto' });
    if (kind === 'NOTICE' && !body) throw validationError('Aviso vazio', { body: 'Escreva o aviso' });
    const now = this.deps.clock.now();
    const asVenue = settings.isModerator && ctx.venue !== null && ctx.target.type !== 'USER_EVENT';
    const record: FeedPostRecord = { id: this.deps.ids.next(), target: ctx.target, authorId: viewerId, kind, body, status: settings.needsApproval ? 'PENDING' : 'PUBLISHED', asVenue, createdAt: now, reviewedAt: null };
    await this.deps.feed.createPost(record, images);
    const me = await this.deps.users.findProfileById(viewerId);
    const name = me?.username ?? 'Alguém';
    if (record.status === 'PENDING') {
      if (ctx.moderatorId) await this.deps.notifier.notify({ userId: ctx.moderatorId, type: 'FEED_PENDING', title: `${name} quer publicar em ${ctx.title}`, body: 'Toque para aprovar ou recusar', url: `${ctx.url}?pendentes=1`, dedupeKey: `feed-pending:${ctx.target.id}` });
    } else {
      await this.afterPublished(record, ctx, settings.isModerator ? (asVenue && ctx.venue ? ctx.venue.name : name) : name);
    }
    return (await this.views(viewerId, ctx, [{ post: record, imageIds: images.map((i) => i.id) }]))[0]!;
  }

  /** Publicada: avisa quem foi marcado com @ e, num aviso de quem modera, quem vai ao evento (ou ligou o sininho do rolê). */
  private async afterPublished(post: FeedPostRecord, ctx: Ctx, authorName: string): Promise<void> {
    const url = `${ctx.url}?post=${post.id}`;
    const mentioned = post.body ? await this.notifyMentions(post.authorId, authorName, ctx, post.body, url, `feed-mention:${post.id}`, 'numa publicação') : new Set<string>();
    if (post.kind !== 'NOTICE' || post.authorId !== ctx.moderatorId) return;
    let audience: string[];
    if (ctx.target.type === 'VENUE') {
      audience = await this.deps.places.listVenueNotifyFollowers(ctx.target.id);
    } else {
      audience = (await this.deps.eventRoom.listGoing({ source: ctx.target.type === 'PLACE_EVENT' ? 'PLACE' : 'USER', id: ctx.target.id })).map((g) => g.userId);
    }
    const blocked = new Set(await this.deps.blocks.listRelatedIds(post.authorId));
    for (const userId of audience.slice(0, FEED_NOTICE_FANOUT_MAX)) {
      if (userId === post.authorId || mentioned.has(userId) || blocked.has(userId)) continue;
      await this.deps.notifier.notify({ userId, type: 'FEED_NOTICE', title: `Aviso de ${authorName} em ${ctx.title}`, body: snippet(post.body, 'Toque para ver'), url, dedupeKey: `feed-notice:${post.id}` });
    }
  }

  /** Avisa quem foi marcado com @ e pode abrir a página. Devolve quem foi avisado. */
  private async notifyMentions(authorId: string, authorName: string, ctx: Ctx, body: string, url: string, dedupe: string, where: string): Promise<Set<string>> {
    const notified = new Set<string>();
    for (const username of extractMentions(body)) {
      const target = await this.deps.users.findProfileByUsername(username);
      if (!target || target.userId === authorId) continue;
      if (await this.deps.blocks.existsEitherWay(authorId, target.userId)) continue;
      try {
        await this.ctxOfTarget(target.userId, ctx.target);
      } catch (failure) {
        if (failure instanceof DomainError) continue;
        throw failure;
      }
      await this.deps.notifier.notify({ userId: target.userId, type: 'FEED_MENTION', title: `${authorName} mencionou você ${where}`, body: snippet(body, 'Toque para ver'), url, dedupeKey: `${dedupe}:${target.userId}` });
      notified.add(target.userId);
    }
    return notified;
  }

  /** Quem modera aprova: a publicação entra no feed e quem escreveu recebe um aviso. */
  async approve(viewerId: string, postId: unknown): Promise<FeedPostView> {
    const { found, ctx } = await this.postFor(viewerId, postId);
    if (ctx.moderatorId !== viewerId) throw forbidden('Só quem organiza aprova publicações');
    const now = this.deps.clock.now();
    if (!(await this.deps.feed.approvePost(found.post.id, now))) throw notFound('Esta publicação não está mais pendente');
    const post: FeedPostRecord = { ...found.post, status: 'PUBLISHED', reviewedAt: now };
    const author = await this.deps.users.findProfileById(post.authorId);
    await this.deps.notifier.notify({ userId: post.authorId, type: 'FEED_APPROVED', title: `Sua publicação em ${ctx.title} foi aprovada`, body: snippet(post.body, 'Já está no feed'), url: `${ctx.url}?post=${post.id}`, dedupeKey: `feed-approved:${post.id}` });
    await this.afterPublished(post, ctx, author?.username ?? 'Alguém');
    return (await this.views(viewerId, ctx, [{ post, imageIds: found.imageIds }]))[0]!;
  }

  /** Quem modera recusa: a publicação é apagada e quem escreveu recebe um aviso. */
  async reject(viewerId: string, postId: unknown): Promise<{ rejected: true }> {
    const { found, ctx } = await this.postFor(viewerId, postId);
    if (ctx.moderatorId !== viewerId) throw forbidden('Só quem organiza recusa publicações');
    if (found.post.status !== 'PENDING') throw notFound('Esta publicação não está mais pendente');
    await this.deps.feed.deletePost(found.post.id);
    await this.deps.notifier.notify({ userId: found.post.authorId, type: 'FEED_REJECTED', title: `Sua publicação em ${ctx.title} não foi aprovada`, body: snippet(found.post.body, 'Quem organiza preferiu não publicar'), url: ctx.url, dedupeKey: `feed-rejected:${found.post.id}` });
    return { rejected: true };
  }

  async remove(viewerId: string, postId: unknown): Promise<{ deleted: true }> {
    const { found, ctx } = await this.postFor(viewerId, postId);
    if (found.post.authorId !== viewerId && ctx.moderatorId !== viewerId) throw forbidden('Só quem publicou ou quem organiza apaga a publicação');
    await this.deps.feed.deletePost(found.post.id);
    return { deleted: true };
  }

  /** Foto de uma publicação, para o <img>. Quem tem o endereço (id aleatório) vê, como nas fotos dos posts. */
  async image(imageId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    const id = shortId(imageId);
    return id ? this.deps.feed.findImage(id) : undefined;
  }

  // ---------- Reações ----------

  private static emoji(value: unknown): string | null {
    if (value === null || value === undefined || value === '') return null;
    if (!isEmoji(value)) throw validationError('Reação inválida', { emoji: 'Use um emoji' });
    return value;
  }

  /** Reage com um emoji (`null` tira a reação). Uma por pessoa: outro emoji troca. */
  async react(viewerId: string, postId: unknown, rawEmoji: unknown): Promise<FeedReactionsView> {
    const { found, ctx } = await this.postFor(viewerId, postId);
    if (found.post.status !== 'PUBLISHED') throw forbidden('Espere a publicação ser aprovada');
    const emoji = FeedService.emoji(rawEmoji);
    const post = found.post;
    if (emoji === null) {
      await this.deps.feed.removeReaction(post.id, viewerId);
    } else {
      await this.deps.feed.setReaction(post.id, viewerId, emoji, this.deps.clock.now());
      if (post.authorId !== viewerId) {
        const me = await this.deps.users.findProfileById(viewerId);
        await this.deps.notifier.notify({ userId: post.authorId, type: 'FEED_REACTION', title: `${me?.username ?? 'Alguém'} reagiu ${emoji} à sua publicação`, body: snippet(post.body, ctx.title), url: `${ctx.url}?post=${post.id}`, dedupeKey: `feed-reaction:${post.id}:${viewerId}` });
      }
    }
    return FeedService.reactions((await this.deps.feed.reactionStats([post.id], viewerId))[0]);
  }

  // ---------- Comentários ----------

  async comments(viewerId: string, postId: unknown, query: { cursor?: unknown; limit?: unknown } = {}): Promise<FeedCommentsPage> {
    const { found, ctx } = await this.postFor(viewerId, postId);
    const after = decodeCursor(query.cursor);
    const limit = pageSize(query.limit, FEED_COMMENTS_PAGE_DEFAULT, FEED_COMMENTS_PAGE_MAX);
    const rows = await this.deps.feed.listComments(found.post.id, { limit: limit + 1, ...(after ? { after } : {}) });
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { items: await this.commentViews(viewerId, ctx, found.post, page), nextCursor: rows.length > limit && last ? encodeCursor(last) : null };
  }

  async addComment(viewerId: string, postId: unknown, rawBody: unknown): Promise<FeedCommentView> {
    const { found, ctx } = await this.postFor(viewerId, postId);
    if (found.post.status !== 'PUBLISHED') throw forbidden('Espere a publicação ser aprovada');
    const body = text(rawBody, FEED_COMMENT_MAX, 'body', 'Comentário');
    if (!body) throw validationError('Comentário vazio', { body: 'Escreva algo para comentar' });
    const record: FeedCommentRecord = { id: this.deps.ids.next(), postId: found.post.id, authorId: viewerId, body, createdAt: this.deps.clock.now() };
    await this.deps.feed.addComment(record);
    const me = await this.deps.users.findProfileById(viewerId);
    const name = me?.username ?? 'Alguém';
    const url = `${ctx.url}?post=${found.post.id}`;
    const mentioned = await this.notifyMentions(viewerId, name, ctx, body, url, `feed-comment-mention:${record.id}`, 'num comentário');
    if (found.post.authorId !== viewerId && !mentioned.has(found.post.authorId)) {
      await this.deps.notifier.notify({ userId: found.post.authorId, type: 'FEED_COMMENT', title: `${name} comentou sua publicação em ${ctx.title}`, body: snippet(body, 'Toque para ver'), url, dedupeKey: `feed-comment:${record.id}` });
    }
    return (await this.commentViews(viewerId, ctx, found.post, [record]))[0]!;
  }

  private async commentFor(viewerId: string, commentId: unknown): Promise<{ comment: FeedCommentRecord; post: FeedPostRecord; ctx: Ctx }> {
    const id = shortId(commentId);
    const comment = id ? await this.deps.feed.findComment(id) : undefined;
    if (!comment) throw notFound('Comentário não encontrado');
    const { found, ctx } = await this.postFor(viewerId, comment.postId);
    if (comment.authorId !== viewerId && (await this.deps.blocks.existsEitherWay(viewerId, comment.authorId))) throw notFound('Comentário não encontrado');
    return { comment, post: found.post, ctx };
  }

  async deleteComment(viewerId: string, commentId: unknown): Promise<{ deleted: true }> {
    const { comment, post, ctx } = await this.commentFor(viewerId, commentId);
    if (comment.authorId !== viewerId && post.authorId !== viewerId && ctx.moderatorId !== viewerId) throw forbidden('Só quem escreveu, o autor da publicação ou quem organiza apaga o comentário');
    await this.deps.feed.deleteComment(comment.id);
    return { deleted: true };
  }

  async reactComment(viewerId: string, commentId: unknown, rawEmoji: unknown): Promise<FeedReactionsView> {
    const { comment, ctx } = await this.commentFor(viewerId, commentId);
    const emoji = FeedService.emoji(rawEmoji);
    if (emoji === null) {
      await this.deps.feed.removeCommentReaction(comment.id, viewerId);
    } else {
      await this.deps.feed.setCommentReaction(comment.id, viewerId, emoji, this.deps.clock.now());
      if (comment.authorId !== viewerId) {
        const me = await this.deps.users.findProfileById(viewerId);
        await this.deps.notifier.notify({ userId: comment.authorId, type: 'FEED_REACTION', title: `${me?.username ?? 'Alguém'} reagiu ${emoji} ao seu comentário`, body: snippet(comment.body, ctx.title), url: `${ctx.url}?post=${comment.postId}`, dedupeKey: `feed-comment-reaction:${comment.id}:${viewerId}` });
      }
    }
    return FeedService.reactions((await this.deps.feed.commentReactionStats([comment.id], viewerId))[0]);
  }

  private async commentViews(viewerId: string, ctx: Ctx, post: FeedPostRecord, rows: FeedCommentRecord[]): Promise<FeedCommentView[]> {
    const hidden = new Set(await this.deps.blocks.listRelatedIds(viewerId));
    const visible = rows.filter((r) => r.authorId === viewerId || !hidden.has(r.authorId));
    if (visible.length === 0) return [];
    const [profiles, stats, mentions] = await Promise.all([
      this.deps.users.findProfilesByIds([...new Set(visible.map((r) => r.authorId))]),
      this.deps.feed.commentReactionStats(visible.map((r) => r.id), viewerId),
      this.mentionsOf(visible.map((r) => r.body)),
    ]);
    const byId = new Map(profiles.map((p) => [p.userId, toPublicProfile(p)]));
    const statsById = new Map(stats.map((s) => [s.id, s]));
    return visible.flatMap((r) => {
      const author = byId.get(r.authorId);
      if (!author) return [];
      const mine = r.authorId === viewerId;
      return [
        {
          id: r.id,
          postId: r.postId,
          author,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
          mine,
          canDelete: mine || post.authorId === viewerId || ctx.moderatorId === viewerId,
          reactions: FeedService.reactions(statsById.get(r.id)),
          mentions: mentions.get(r.body) ?? [],
        },
      ];
    });
  }
}
