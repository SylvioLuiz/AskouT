import { buildRetentionReport } from './retention.ts';
import type { RetentionReport } from './retention.ts';
import { conflict, forbidden, notFound, unauthorized, validationError } from './errors.ts';
import type { AuthResult, AuthService, LoginInput } from './auth-service.ts';
import type { CoreDeps } from './ports.ts';
import type { VenueService } from './venue-service.ts';
import type { Actor, AdminConversationReportRow, AdminPlaceEventRow, AdminPostReportRow, AdminPostRow, AdminStats, AdminStoryReportRow, AdminUserRow, AdminVenueRow, AuditAction, AuditRecord, AuditRow, Page, ReportResolution, UserStatus } from './types.ts';
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

  constructor(deps: CoreDeps, venues: VenueService, auth: AuthService) {
    this.deps = deps;
    this.venues = venues;
    this.auth = auth;
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
    return this.deps.admin.stats();
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
        venue: { id: venue.id, name: venue.name, address: venue.address, isSample: venue.isSample, ownerId: venue.ownerId ?? null },
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

  // ---------- Auditoria ----------

  async audit(actor: Actor, query: { limit?: unknown; offset?: unknown }): Promise<AdminPage<AuditRow>> {
    this.assertAdmin(actor);
    return this.paged(query, (page) => this.deps.admin.listAudit(page));
  }
}
