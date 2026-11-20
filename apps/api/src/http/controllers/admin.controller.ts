import { Body, Controller, Delete, Get, Header, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** Gestão do aplicativo. Todas as rotas exigem conta ADMIN (o serviço confere); o login é separado do app. */
@Controller('admin')
export class AdminController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.login({ identifier: b.identifier, password: b.password });
  }

  @Public()
  @Post('social')
  @HttpCode(200)
  social(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.socialLogin({ provider: b.provider, idToken: b.idToken });
  }

  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  mfaVerify(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.verifyMfaLogin({ mfaToken: b.mfaToken, code: b.code });
  }

  /** `{currentPassword, newPassword}`: troca a senha de quem está logado. Devolve `{token}` novo para este aparelho. */
  @Post('password')
  @HttpCode(200)
  changePassword(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.changeOwnPassword(actor, { currentPassword: b.currentPassword, newPassword: b.newPassword });
  }

  @Get('stats')
  stats(@CurrentActor() actor: Actor) {
    return this.core.admin.stats(actor);
  }

  /** Estado da chave geral do pagamento do impulsionamento. */
  @Get('payments')
  payments(@CurrentActor() actor: Actor) {
    return this.core.admin.payments(actor);
  }

  /** `{enabled: boolean, note?}`: liga ou desliga na hora (ligar exige provedor configurado). */
  @Put('payments')
  setPayments(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.setPayments(actor, b.enabled, b.note);
  }

  /** Configurações de evento cadastradas e os ícones disponíveis. */
  @Get('event-extras')
  eventExtras(@CurrentActor() actor: Actor) {
    return this.core.admin.eventExtras(actor);
  }

  /** `{icon, label, type: 'YES_NO' | 'TEXT'}` */
  @Post('event-extras')
  createEventExtra(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.createEventExtra(actor, { icon: b.icon, label: b.label, type: b.type });
  }

  @Put('event-extras/:id')
  updateEventExtra(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.updateEventExtra(actor, id, { icon: b.icon, label: b.label, type: b.type });
  }

  /** `{direction: 'up' | 'down'}`: muda a ordem em que aparecem no app. */
  @Post('event-extras/:id/move')
  @HttpCode(200)
  moveEventExtra(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.moveEventExtra(actor, id, asBody(body).direction);
  }

  @Delete('event-extras/:id')
  deleteEventExtra(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.admin.deleteEventExtra(actor, id);
  }

  /** Gostos de rolê cadastrados (a ordem é a das telas do app). */
  @Get('tastes')
  tastes(@CurrentActor() actor: Actor) {
    return this.core.admin.tastes(actor);
  }

  /** `{label, hint, keywords: string[] | string, kinds: EventKind[]}` */
  @Post('tastes')
  createTaste(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.createTaste(actor, { icon: b.icon, label: b.label, hint: b.hint, keywords: b.keywords, kinds: b.kinds });
  }

  @Put('tastes/:id')
  updateTaste(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.updateTaste(actor, id, { icon: b.icon, label: b.label, hint: b.hint, keywords: b.keywords, kinds: b.kinds });
  }

  /** `{direction: 'up' | 'down'}` */
  @Post('tastes/:id/move')
  @HttpCode(200)
  moveTaste(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.moveTaste(actor, id, asBody(body).direction);
  }

  @Delete('tastes/:id')
  deleteTaste(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.admin.deleteTaste(actor, id);
  }

  /** Quem mais trouxe gente pelo convite (`?limit=`, até 50). */
  @Get('referrals/top')
  topInviters(@CurrentActor() actor: Actor, @Query() q: { limit?: unknown }) {
    const n = Number(q.limit);
    return this.core.referrals.adminTop(actor, Number.isFinite(n) && q.limit !== undefined ? n : undefined);
  }

  @Get('reco-experiment')
  recoExperiment(@CurrentActor() actor: Actor) {
    return this.core.admin.recoExperimentState(actor);
  }

  @Put('reco-experiment')
  setRecoExperiment(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.setRecoExperiment(actor, b.enabled, b.controlPercent, b.note);
  }

  @Get('retention')
  retention(@CurrentActor() actor: Actor, @Query() q: { days?: unknown }) {
    return this.core.admin.retention(actor, q);
  }

  @Get('claims')
  claims(@CurrentActor() actor: Actor, @Query() q: { status?: unknown; limit?: unknown }) {
    return this.core.admin.listClaims(actor, q);
  }

  @Get('claims/:id/document')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', 'inline')
  async claimDocument(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const doc = await this.core.admin.claimDocument(actor, id);
    if (!doc) throw new NotFoundException();
    return new StreamableFile(doc.data, { type: doc.mime });
  }

  /** `{decision: 'APPROVED'|'REJECTED', note?}` */
  @Post('claims/:id/review')
  @HttpCode(200)
  review(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.reviewClaim(actor, id, b.decision, b.note);
  }

  @Get('users')
  users(@CurrentActor() actor: Actor, @Query() q: { q?: unknown; status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.searchUsers(actor, q);
  }

  /** `{status: 'ACTIVE'|'SUSPENDED', note?}` (motivo obrigatório ao suspender) */
  @Put('users/:id/status')
  setStatus(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.setUserStatus(actor, id, b.status, b.note);
  }

  /** `{birthDate: 'AAAA-MM-DD', note}`: corrige a data de nascimento (motivo obrigatório). */
  @Put('users/:id/birth-date')
  setBirthDate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.setUserBirthDate(actor, id, b.birthDate, b.note);
  }

  @Get('venues')
  venues(@CurrentActor() actor: Actor, @Query() q: { q?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.searchVenues(actor, q);
  }

  /** Detalhe do local: cadastro, origem, responsável, seguidores e eventos. */
  @Get('venues/:id')
  venue(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.admin.venueDetail(actor, id);
  }

  @Delete('venues/:id/owner')
  removeOwner(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.removeVenueOwner(actor, id, asBody(body).note);
  }

  @Get('place-events')
  placeEvents(@CurrentActor() actor: Actor, @Query() q: { q?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.searchPlaceEvents(actor, q);
  }

  @Delete('place-events/:id')
  deletePlaceEvent(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.deletePlaceEvent(actor, id, asBody(body).note);
  }

  @Get('posts')
  posts(@CurrentActor() actor: Actor, @Query() q: { q?: unknown; events?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.searchPosts(actor, q);
  }

  @Delete('posts/:id')
  deletePost(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.deletePost(actor, id, asBody(body).note);
  }

  /** Apaga um comentário de post (ex.: denunciado). `{note}` obrigatório. */
  @Delete('comments/:id')
  deleteComment(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.deletePostComment(actor, id, asBody(body).note);
  }

  @Get('reports/posts')
  postReports(@CurrentActor() actor: Actor, @Query() q: { status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.postReports(actor, q);
  }

  @Get('reports/stories')
  storyReports(@CurrentActor() actor: Actor, @Query() q: { status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.storyReports(actor, q);
  }

  @Post('reports/stories/:id/resolve')
  @HttpCode(200)
  resolveStory(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.resolveStoryReport(actor, id, b.resolution, b.note);
  }

  @Delete('stories/:id')
  deleteStory(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.deleteStory(actor, id, asBody(body).note);
  }

  @Get('stories/:id/media')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Content-Disposition', 'inline')
  async storyMedia(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const media = await this.core.admin.storyMedia(actor, id);
    if (!media) throw new NotFoundException();
    return new StreamableFile(media.data, { type: media.mime });
  }

  @Get('reports/conversations')
  conversationReports(@CurrentActor() actor: Actor, @Query() q: { status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.conversationReports(actor, q);
  }

  @Get('reports/users')
  userReports(@CurrentActor() actor: Actor, @Query() q: { status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.userReports(actor, q);
  }

  /** `{resolution: 'DISMISSED'|'ACTIONED', note?}` */
  @Post('reports/users/:id/resolve')
  @HttpCode(200)
  resolveUserReport(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.resolveUserReport(actor, id, b.resolution, b.note);
  }

  @Post('reports/posts/:id/resolve')
  @HttpCode(200)
  resolvePost(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.resolvePostReport(actor, id, b.resolution, b.note);
  }

  @Post('reports/conversations/:id/resolve')
  @HttpCode(200)
  resolveConversation(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.resolveConversationReport(actor, id, b.resolution, b.note);
  }

  /** Publicações de todos os feeds de evento e rolê. `?status=pending|published`, `?q=` (texto ou @autor). */
  @Get('feed/posts')
  feedPosts(@CurrentActor() actor: Actor, @Query() q: { q?: unknown; status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.feedPosts(actor, q);
  }

  @Get('feed/posts/:id/comments')
  feedComments(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.admin.feedComments(actor, id);
  }

  /** `{note}` (motivo obrigatório) */
  @Delete('feed/posts/:id')
  deleteFeedPost(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.deleteFeedPost(actor, id, asBody(body).note);
  }

  @Delete('feed/comments/:id')
  deleteFeedComment(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.admin.deleteFeedComment(actor, id, asBody(body).note);
  }

  @Get('reports/feed')
  feedReports(@CurrentActor() actor: Actor, @Query() q: { status?: unknown; limit?: unknown; offset?: unknown }) {
    return this.core.admin.feedReports(actor, q);
  }

  /** `{resolution: 'DISMISSED'|'ACTIONED', note?}` */
  @Post('reports/feed/:id/resolve')
  @HttpCode(200)
  resolveFeedReport(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.admin.resolveFeedReport(actor, id, b.resolution, b.note);
  }

  @Get('audit')
  audit(@CurrentActor() actor: Actor, @Query() q: { limit?: unknown; offset?: unknown }) {
    return this.core.admin.audit(actor, q);
  }
}
