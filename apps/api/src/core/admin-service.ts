import { MIN_ACCOUNT_AGE, parseBirthDate } from './age-service.ts';
import { buildRetentionReport } from './retention.ts';
import type { RetentionReport } from './retention.ts';
import { conflict, forbidden, notFound, unauthorized, validationError } from './errors.ts';
import type { AuthResult, AuthService, LoginInput, SocialLoginInput } from './auth-service.ts';
import type { CoreDeps } from './ports.ts';
import type { VenueService } from './venue-service.ts';
import type { PaymentsState, PaymentsSwitch } from './payments-switch.ts';
import type { Actor, AdminFeedCommentRow, AdminFeedPlace, AdminFeedPostRow, AdminFeedReportRow, FeedPostStatus, FeedPostWithImages, FeedTarget, AdminConversationReportRow, AdminUserReportRow, AdminPlaceEventRow, AdminPostReportRow, AdminPostRow, AdminStats, AdminStoryReportRow, AdminUserRow, AdminVenueRow, AuditAction, AuditRecord, AuditRow, Page, ReportResolution, UserStatus } from './types.ts';
import { REPORT_RESOLUTIONS } from './types.ts';

export const ADMIN_PAGE_DEFAULT = 25;
export const ADMIN_PAGE_MAX = 100;
export const ADMIN_NOTE_MAX = 300;
export const ADMIN_QUERY_MAX = 80;

export interface AdminPage<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

function parsePage(query: { limit?: unknown; offset?: unknown }): Page {
  const num = (v: unknown, fallback: number) => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number(v) : typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback);
  return { limit: Math.min(Math.max(num(query.limit, ADMIN_PAGE_DEFAULT), 1), ADMIN_PAGE_MAX), offset: num(query.offset, 0) };
}

function queryText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw validationError('Busca inválida', { q: 'Busca inválida' });
  const t = value.trim();
  if (Array.from(t).length > ADMIN_QUERY_MAX) throw validationError('Busca inválida', { q: `Use até ${ADMIN_QUERY_MAX} caracteres` });
  return t;
}

function noteText(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw validationError('Dados inválidos', { note: 'Explique o motivo' });
    return null;
  }
  if (typeof value !== 'string') throw validationError('Dados inválidos', { note: 'Motivo inválido' });
  const t = value.trim();
  if (t === '') {
    if (required) throw validationError('Dados inválidos', { note: 'Explique o motivo' });
    return null;
  }
  if (Array.from(t).length > ADMIN_NOTE_MAX) throw validationError('Dados inválidos', { note: `O motivo pode ter até ${ADMIN_NOTE_MAX} caracteres` });
  return t;
}

/** Gestão do aplicativo. Todo método exige papel ADMIN (vindo do banco a cada requisição) e as ações ficam no registro de auditoria. */
/** Teto de linhas lidas por consulta do painel. Acima disso, o painel avisa que cortou os dados mais antigos. */
export const RETENTION_MAX_ROWS = 200_000;

export class AdminService {
  private readonly deps: CoreDeps;
  private readonly venues: VenueService;
  private readonly auth: AuthService;
  private readonly paymentsSwitch: PaymentsSwitch;

  constructor(deps: CoreDeps, venues: VenueService, auth: AuthService, paymentsSwitch: PaymentsSwitch) {
    this.deps = deps;
    this.venues = venues;
    this.auth = auth;
    this.paymentsSwitch = paymentsSwitch;
  }

  /**
   * Entrada do painel. Mesma senha da conta, mas só entra quem é admin; para os demais a resposta é a mesma de
   * senha errada, sem revelar que a conta existe ou que não é admin.
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const result = await this.auth.login(input);
    if (result.user.role !== 'ADMIN') throw unauthorized();
    return result;
  }

  /**
   * Entrada do painel pela plataforma (Apple). Nunca cria conta: nome de usuário e aceite do cadastro não são repassados,
   * então conta externa nova para em `needsProfile` e é recusada. Quem não é admin também não entra.
   */
  async socialLogin(input: Pick<SocialLoginInput, 'provider' | 'idToken'>): Promise<AuthResult> {
    const result = await this.auth.socialLogin({ provider: input.provider, idToken: input.idToken });
    if ('needsProfile' in result || result.user.role !== 'ADMIN') throw unauthorized('Essa conta não tem acesso à gestão');
    return result;
  }

  /** Troca a própria senha pelo painel. */
  async changeOwnPassword(actor: Actor, input: { currentPassword: unknown; newPassword: unknown }): Promise<void> {
    this.assertAdmin(actor);
    await this.auth.changePassword(actor.userId, input);
  }

  private assertAdmin(actor: Actor): void {
    if (actor.role !== 'ADMIN') throw forbidden('Acesso restrito a administradores');
  }

  private async log(adminId: string, action: AuditAction, targetType: AuditRecord['targetType'], targetId: string, note: string | null): Promise<void> {
    await this.deps.admin.addAudit({ id: this.deps.ids.next(), adminId, action, targetType, targetId, note, createdAt: this.deps.clock.now() });
  }

  private async paged<T>(query: { limit?: unknown; offset?: unknown }, fetch: (page: Page) => Promise<T[]>): Promise<AdminPage<T>> {
    const page = parsePage(query);
    const rows = await fetch({ limit: page.limit + 1, offset: page.offset });
    return { items: rows.slice(0, page.limit), limit: page.limit, offset: page.offset, hasMore: rows.length > page.limit };
  }

  async stats(actor: Actor): Promise<AdminStats> {
    this.assertAdmin(actor);
    const [base, openFeedReports, pendingFeedPosts] = await Promise.all([this.deps.admin.stats(), this.deps.feed.countOpenReports(), this.deps.feed.countAllPosts('PENDING')]);
    return { ...base, openFeedReports, pendingFeedPosts };
  }

  /** Painel de retenção: bloco "Para você" contra o feed, e quem volta depois de um dia com atividade. */
  async retention(actor: Actor, query: { days?: unknown }): Promise<RetentionReport> {
    this.assertAdmin(actor);
    const days = query.days === undefined ? 14 : Number(query.days);
    if (!Number.isInteger(days) || days < 1 || days > 60) throw validationError('Período inválido', { days: 'Entre 1 e 60 dias' });
    const now = this.deps.clock.now();
    // Margem de um dia por causa do fuso; o corte exato é feito na montagem.
    const rows = await this.deps.dwell.listAllSince(new Date(now.getTime() - (days + 1) * 86_400_000), RETENTION_MAX_ROWS + 1);
    const truncated = rows.length > RETENTION_MAX_ROWS;
    return buildRetentionReport(truncated ? rows.slice(0, RETENTION_MAX_ROWS) : rows, now, days, truncated);
  }

  // ---------- Pedidos de donos ----------

  async listClaims(actor: Actor, query: { status?: unknown; limit?: unknown }) {
    this.assertAdmin(actor);
    const status = query.status === 'APPROVED' || query.status === 'REJECTED' ? query.status : 'PENDING';
    const claims = await this.deps.claims.listByStatus(status, parsePage({ limit: query.limit }).limit);
    const out = [];
    for (const c of claims) {
      const venue = await this.deps.places.findVenue(c.venueId);
      const profile = await this.deps.users.findProfileById(c.userId);
      const user = await this.deps.users.findById(c.userId);
      if (!venue || !profile) continue;
      out.push({
        id: c.id, status: c.status, note: c.note, documentMime: c.documentMime, reviewNote: c.reviewNote, createdAt: c.createdAt, reviewedAt: c.reviewedAt,
        venue: { id: venue.id, name: venue.name, address: venue.address, isSample: venue.isSample, ownerId: venue.ownerId ?? null, isOrganization: venue.isOrganization === true, category: venue.category, description: venue.description ?? null },
        user: { id: c.userId, username: profile.username, displayName: profile.displayName, email: user?.email ?? '' },
      });
    }
    return out;
  }

  async claimDocument(actor: Actor, claimId: unknown) {
    this.assertAdmin(actor);
    return this.venues.claimDocument(actor.userId, claimId);
  }

  async reviewClaim(actor: Actor, claimId: unknown, decision: unknown, note: unknown) {
    this.assertAdmin(actor);
    const result = await this.venues.reviewClaim(actor.userId, claimId, decision, note);
    await this.log(actor.userId, result.status === 'APPROVED' ? 'CLAIM_APPROVED' : 'CLAIM_REJECTED', 'CLAIM', result.id, result.reviewNote);
    return result;
  }

  // ---------- Pessoas ----------

  async searchUsers(actor: Actor, query: { q?: unknown; status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminUserRow>> {
    this.assertAdmin(actor);
    const status: UserStatus | undefined = query.status === 'ACTIVE' || query.status === 'SUSPENDED' || query.status === 'DELETION_REQUESTED' ? query.status : undefined;
    const text = queryText(query.q);
    return this.paged(query, (page) => this.deps.admin.searchUsers(text, status, page));
  }

  /** Suspende (banir) ou reativa. Admins e a própria conta não podem ser suspensos. */
  async setUserStatus(actor: Actor, userId: unknown, status: unknown, note: unknown): Promise<{ id: string; status: UserStatus }> {
    this.assertAdmin(actor);
    if (status !== 'ACTIVE' && status !== 'SUSPENDED') throw validationError('Status inválido', { status: 'Use ACTIVE ou SUSPENDED' });
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    if (target.id === actor.userId) throw conflict('Você não pode suspender a própria conta');
    if (target.role === 'ADMIN') throw conflict('Contas de administrador não podem ser suspensas por aqui');
    const reason = noteText(note, status === 'SUSPENDED');
    if (target.status === status) throw conflict(status === 'SUSPENDED' ? 'A conta já está suspensa' : 'A conta já está ativa');
    if (!(await this.deps.admin.setUserStatus(target.id, status))) throw notFound('Usuário não encontrado');
    await this.log(actor.userId, status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_REACTIVATED', 'USER', target.id, reason);
    return { id: target.id, status };
  }

  /**
   * Corrige a data de nascimento de uma pessoa (erro de digitação que a pessoa (conta antiga marcada como menor) não pode consertar sozinha).
   * Motivo obrigatório; a data antiga e a nova ficam na auditoria. Contas de administrador não passam por aqui.
   */
  async setUserBirthDate(actor: Actor, userId: unknown, birthDate: unknown, note: unknown): Promise<{ id: string; birthDate: string }> {
    this.assertAdmin(actor);
    const target = typeof userId === 'string' && userId.length <= 64 ? await this.deps.users.findById(userId) : undefined;
    if (!target) throw notFound('Usuário não encontrado');
    if (target.role === 'ADMIN') throw conflict('Contas de administrador não passam por aqui');
    const parsed = parseBirthDate(birthDate, this.deps.clock.now());
    if (parsed.age < MIN_ACCOUNT_AGE) throw validationError(`O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais`, { birthDate: `O AskouT é para quem tem ${MIN_ACCOUNT_AGE} anos ou mais` });
    const reason = noteText(note, true);
    const before = target.birthDate ?? null;
    if (before === parsed.birthDate) throw conflict('Essa já é a data cadastrada');
    await this.deps.users.updateBirthDate(target.id, parsed.birthDate);
    await this.log(actor.userId, 'USER_BIRTHDATE_CHANGED', 'USER', target.id, `${reason ?? ''} (de ${before ?? 'sem data'} para ${parsed.birthDate})`.slice(0, 400));
    return { id: target.id, birthDate: parsed.birthDate };
  }

  // ---------- Pagamentos (chave geral do impulsionamento) ----------

  async payments(actor: Actor): Promise<PaymentsState> {
    this.assertAdmin(actor);
    return this.paymentsSwitch.state();
  }

  /**
   * Liga ou desliga o impulsionamento pago, na hora. Ligar só é possível com um provedor de pagamento configurado no servidor.
   * Desligar não derruba anúncios já pagos nem pagamentos em andamento; só bloqueia pedidos novos.
   */
  async setPayments(actor: Actor, enabled: unknown, note: unknown): Promise<PaymentsState> {
    this.assertAdmin(actor);
    if (typeof enabled !== 'boolean') throw validationError('Dados inválidos', { enabled: 'Use true ou false' });
    const reason = noteText(note, false);
    const before = await this.paymentsSwitch.state();
    if (enabled && !before.canEnable) throw conflict(before.blocker ?? 'Não é possível ligar o pagamento agora');
    if (before.enabled === enabled) throw conflict(enabled ? 'O pagamento já está ligado' : 'O pagamento já está desligado');
    await this.paymentsSwitch.set(enabled, actor.userId);
    await this.log(actor.userId, enabled ? 'PAYMENTS_ENABLED' : 'PAYMENTS_DISABLED', 'SETTING', 'payments', reason);
    return this.paymentsSwitch.state();
  }

  // ---------- Locais, eventos e posts ----------

  async searchVenues(actor: Actor, query: { q?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminVenueRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    return this.paged(query, (page) => this.deps.admin.searchVenues(text, page));
  }

  /** Tira o responsável de um local (ele volta a poder ser reivindicado). */
  async removeVenueOwner(actor: Actor, venueId: unknown, note: unknown): Promise<{ removed: true }> {
    this.assertAdmin(actor);
    const venue = typeof venueId === 'string' && venueId.length <= 64 ? await this.deps.places.findVenue(venueId) : undefined;
    if (!venue) throw notFound('Local não encontrado');
    if (!venue.ownerId) throw conflict('Este local não tem responsável');
    const reason = noteText(note, true);
    await this.deps.places.setVenueOwner(venue.id, null);
    await this.log(actor.userId, 'VENUE_OWNER_REMOVED', 'VENUE', venue.id, reason);
    return { removed: true };
  }

  async searchPlaceEvents(actor: Actor, query: { q?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminPlaceEventRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    return this.paged(query, (page) => this.deps.admin.searchPlaceEvents(text, page));
  }

  async deletePlaceEvent(actor: Actor, eventId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    if (typeof eventId !== 'string' || eventId.length > 64 || !(await this.deps.admin.deletePlaceEvent(eventId))) throw notFound('Evento não encontrado');
    await this.log(actor.userId, 'PLACE_EVENT_REMOVED', 'PLACE_EVENT', eventId, reason);
    return { deleted: true };
  }

  async searchPosts(actor: Actor, query: { q?: unknown; events?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminPostRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    const onlyEvents = query.events === 'true' || query.events === true;
    return this.paged(query, (page) => this.deps.admin.searchPosts(text, onlyEvents, page));
  }

  async deletePost(actor: Actor, postId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    if (typeof postId !== 'string' || postId.length > 64 || !(await this.deps.admin.deletePost(postId))) throw notFound('Post não encontrado');
    await this.log(actor.userId, 'POST_REMOVED', 'POST', postId, reason);
    return { deleted: true };
  }

  /** Apaga um comentário de post (ex.: o denunciado na aba "Perfis e comentários"). */
  async deletePostComment(actor: Actor, commentId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    const comment = typeof commentId === 'string' && commentId.length <= 64 ? await this.deps.posts.findComment(commentId) : undefined;
    if (!comment) throw notFound('Comentário não encontrado');
    await this.deps.posts.deleteComment(comment.id);
    await this.log(actor.userId, 'COMMENT_REMOVED', 'COMMENT', comment.id, reason);
    return { deleted: true };
  }

  // ---------- Denúncias ----------

  async postReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminPostReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listPostReports(open, page));
  }

  async storyReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminStoryReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listStoryReports(open, page));
  }

  async resolveStoryReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findStoryReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolveStoryReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'STORY_REPORT', report.id, text);
    return { resolved: true };
  }

  /** Tira um story do ar (some também para quem o denunciou e leva as denúncias dele). */
  async deleteStory(actor: Actor, storyId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const text = noteText(note, true);
    if (typeof storyId !== 'string' || storyId.length > 64 || !(await this.deps.admin.deleteStory(storyId))) throw notFound('Story não encontrado');
    await this.log(actor.userId, 'STORY_REMOVED', 'STORY', storyId, text);
    return { deleted: true };
  }

  /** A foto ou o vídeo denunciado, para a gestão conferir (vale mesmo depois de vencido, enquanto existir). */
  async storyMedia(actor: Actor, storyId: unknown): Promise<{ mime: string; data: Uint8Array } | undefined> {
    this.assertAdmin(actor);
    return typeof storyId === 'string' && storyId.length <= 64 ? this.deps.admin.findStoryMedia(storyId) : undefined;
  }

  async conversationReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminConversationReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listConversationReports(open, page));
  }

  async userReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminUserReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, (page) => this.deps.admin.listUserReports(open, page));
  }

  async resolveUserReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findUserReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolveUserReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'USER_REPORT', report.id, text);
    return { resolved: true };
  }

  /** Encerra uma denúncia de post sem ou com providência. A providência em si (remover o post, suspender a conta) é outra chamada. */
  async resolvePostReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findPostReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolvePostReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'POST_REPORT', report.id, text);
    return { resolved: true };
  }

  async resolveConversationReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.admin.findConversationReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.admin.resolveConversationReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'CONVERSATION_REPORT', report.id, text);
    return { resolved: true };
  }

  private parseResolution(value: unknown): ReportResolution {
    if (typeof value !== 'string' || !(REPORT_RESOLUTIONS as readonly string[]).includes(value)) throw validationError('Decisão inválida', { resolution: 'Use DISMISSED ou ACTIONED' });
    return value as ReportResolution;
  }

  // ---------- Feed dos eventos e rolês ----------

  /** Nome e caminho da página onde está o feed (o evento ou o rolê). */
  private async feedPlace(target: FeedTarget): Promise<AdminFeedPlace> {
    if (target.type === 'PLACE_EVENT') {
      const found = await this.deps.places.findEvent(target.id);
      return { type: target.type, id: target.id, title: found ? `${found.event.title} · ${found.venue.name}` : '(evento removido)', url: `/eventos/${target.id}` };
    }
    if (target.type === 'USER_EVENT') {
      const found = await this.deps.posts.findById(target.id);
      return { type: target.type, id: target.id, title: found?.post.eventTitle ?? '(evento removido)', url: `/eventos/${target.id}` };
    }
    const venue = await this.deps.places.findVenue(target.id);
    return { type: target.type, id: target.id, title: venue?.name ?? '(rolê removido)', url: `/bares/${target.id}` };
  }

  private async usernames(ids: string[]): Promise<Map<string, string>> {
    const profiles = await this.deps.users.findProfilesByIds([...new Set(ids)]);
    return new Map(profiles.map((p) => [p.userId, p.username]));
  }

  private async feedPostRows(rows: FeedPostWithImages[]): Promise<AdminFeedPostRow[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.post.id);
    const [names, comments, reports] = await Promise.all([this.usernames(rows.map((r) => r.post.authorId)), this.deps.feed.commentCounts(ids), this.deps.feed.openReportCounts(ids, [])]);
    const places = new Map<string, AdminFeedPlace>();
    const out: AdminFeedPostRow[] = [];
    for (const { post, imageIds } of rows) {
      const key = `${post.target.type}:${post.target.id}`;
      const place = places.get(key) ?? (await this.feedPlace(post.target));
      places.set(key, place);
      out.push({
        id: post.id, kind: post.kind, status: post.status, body: post.body, createdAt: post.createdAt,
        author: { id: post.authorId, username: names.get(post.authorId) ?? '(removido)' }, place, imageIds,
        commentsCount: comments.get(post.id) ?? 0, openReportsCount: reports.posts.get(post.id) ?? 0,
      });
    }
    return out;
  }

  /** Publicações de todos os feeds. `status=pending`: só as que esperam aprovação de quem organiza. */
  async feedPosts(actor: Actor, query: { q?: unknown; status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminFeedPostRow>> {
    this.assertAdmin(actor);
    const text = queryText(query.q);
    const status: FeedPostStatus | undefined = query.status === 'pending' ? 'PENDING' : query.status === 'published' ? 'PUBLISHED' : undefined;
    return this.paged(query, async (page) => this.feedPostRows(await this.deps.feed.adminListPosts({ text, page, ...(status ? { status } : {}) })));
  }

  /** Comentários de uma publicação (do mais antigo ao mais novo), para conferir e apagar. */
  async feedComments(actor: Actor, postId: unknown): Promise<{ items: AdminFeedCommentRow[] }> {
    this.assertAdmin(actor);
    const found = typeof postId === 'string' && postId.length <= 64 ? await this.deps.feed.findPost(postId) : undefined;
    if (!found) throw notFound('Publicação não encontrada');
    const rows = await this.deps.feed.listComments(found.post.id, { limit: 500 });
    const [names, reports] = await Promise.all([this.usernames(rows.map((r) => r.authorId)), this.deps.feed.openReportCounts([], rows.map((r) => r.id))]);
    return {
      items: rows.map((c) => ({ id: c.id, postId: c.postId, body: c.body, createdAt: c.createdAt, author: { id: c.authorId, username: names.get(c.authorId) ?? '(removido)' }, openReportsCount: reports.comments.get(c.id) ?? 0 })),
    };
  }

  /** Tira uma publicação do feed (com fotos, comentários e denúncias). Motivo obrigatório. */
  async deleteFeedPost(actor: Actor, postId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    if (typeof postId !== 'string' || postId.length > 64 || !(await this.deps.feed.deletePost(postId))) throw notFound('Publicação não encontrada');
    await this.log(actor.userId, 'FEED_POST_REMOVED', 'FEED_POST', postId, reason);
    return { deleted: true };
  }

  /** Tira um comentário do feed (com as denúncias dele). Motivo obrigatório. */
  async deleteFeedComment(actor: Actor, commentId: unknown, note: unknown): Promise<{ deleted: true }> {
    this.assertAdmin(actor);
    const reason = noteText(note, true);
    if (typeof commentId !== 'string' || commentId.length > 64 || !(await this.deps.feed.deleteComment(commentId))) throw notFound('Comentário não encontrado');
    await this.log(actor.userId, 'FEED_COMMENT_REMOVED', 'FEED_COMMENT', commentId, reason);
    return { deleted: true };
  }

  async feedReports(actor: Actor, query: { status?: unknown; limit?: unknown; offset?: unknown }): Promise<AdminPage<AdminFeedReportRow>> {
    this.assertAdmin(actor);
    const open = query.status !== 'resolved';
    return this.paged(query, async (page) => {
      const reports = await this.deps.feed.listReports(open, page);
      if (reports.length === 0) return [];
      const postIds = [...new Set(reports.map((r) => r.postId))];
      const found = (await Promise.all(postIds.map((id) => this.deps.feed.findPost(id)))).flatMap((f) => (f ? [f] : []));
      const posts = new Map((await this.feedPostRows(found)).map((p) => [p.id, p]));
      const commentIds = reports.flatMap((r) => (r.commentId ? [r.commentId] : []));
      const alive = new Set((await Promise.all(commentIds.map((id) => this.deps.feed.findComment(id)))).flatMap((c) => (c ? [c.id] : [])));
      const people = new Map<string, { username: string; status: UserStatus }>();
      for (const id of new Set(reports.flatMap((r) => [r.reporterId, r.reportedUserId]))) {
        const [user, profile] = await Promise.all([this.deps.users.findById(id), this.deps.users.findProfileById(id)]);
        people.set(id, { username: profile?.username ?? '(removido)', status: user?.status ?? 'ACTIVE' });
      }
      return reports.map((r) => ({
        id: r.id, kind: r.kind, reason: r.reason, details: r.details, evidence: r.evidence, createdAt: r.createdAt,
        reporter: { id: r.reporterId, username: people.get(r.reporterId)?.username ?? '(removido)' },
        reported: { id: r.reportedUserId, username: people.get(r.reportedUserId)?.username ?? '(removido)', status: people.get(r.reportedUserId)?.status ?? 'ACTIVE' },
        post: posts.get(r.postId) ?? null,
        commentId: r.commentId,
        commentAlive: r.commentId !== null && alive.has(r.commentId),
        resolvedAt: r.resolvedAt ?? null, resolution: r.resolution ?? null, resolutionNote: r.resolutionNote ?? null,
      }));
    });
  }

  async resolveFeedReport(actor: Actor, reportId: unknown, resolution: unknown, note: unknown): Promise<{ resolved: true }> {
    this.assertAdmin(actor);
    const res = this.parseResolution(resolution);
    const text = noteText(note, false);
    const report = typeof reportId === 'string' && reportId.length <= 64 ? await this.deps.feed.findReport(reportId) : undefined;
    if (!report) throw notFound('Denúncia não encontrada');
    if (!(await this.deps.feed.resolveReport(report.id, actor.userId, res, text, this.deps.clock.now()))) throw conflict('Esta denúncia já foi decidida');
    await this.log(actor.userId, res === 'DISMISSED' ? 'REPORT_DISMISSED' : 'REPORT_ACTIONED', 'FEED_REPORT', report.id, text);
    return { resolved: true };
  }

  // ---------- Auditoria ----------

  async audit(actor: Actor, query: { limit?: unknown; offset?: unknown }): Promise<AdminPage<AuditRow>> {
    this.assertAdmin(actor);
    return this.paged(query, (page) => this.deps.admin.listAudit(page));
  }
}
