import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller('conversations')
export class ConversationsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get()
  async list(@CurrentActor() actor: Actor) {
    return { items: await this.core.conversations.list(actor.userId) };
  }

  /** Abre (ou cria) a conversa com um amigo. */
  @Post()
  @HttpCode(200)
  open(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.conversations.open(actor.userId, asBody(body).userId);
  }

  /** `{name, memberIds}`: novo grupo com amigos. */
  @Post('groups')
  @HttpCode(200)
  createGroup(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.conversations.createGroup(actor.userId, { name: b.name, memberIds: b.memberIds });
  }

  @Get(':id/messages')
  messages(
    @CurrentActor() actor: Actor,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.core.conversations.messages(actor.userId, id, { limit, before });
  }

  @Post(':id/messages')
  send(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.conversations.send(actor.userId, id, { body: b.body, suggestion: b.suggestion, eventId: b.eventId, audio: b.audio, audioMs: b.audioMs, replyToId: b.replyToId });
  }

  /**
   * Foto ou vídeo: o corpo é o arquivo cru (`Content-Type: image/jpeg`, `video/mp4`...), sem base64.
   * `?replyTo=<id da mensagem>` responde a uma mensagem.
   */
  @Post(':id/media')
  upload(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Headers('content-type') contentType: string | undefined, @Body() body: unknown, @Query('replyTo') replyTo?: string) {
    return this.core.conversations.send(actor.userId, id, { media: { mime: contentType, data: Buffer.isBuffer(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined }, replyToId: replyTo });
  }

  /** Foto ou vídeo de uma mensagem. Exige o token: o app baixa e mostra a partir de um blob. */
  @Get(':id/messages/:messageId/media')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async media(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('messageId', new ParseUUIDPipe()) messageId: string) {
    const found = await this.core.conversations.media(actor.userId, id, messageId);
    return new StreamableFile(found.data, { type: found.mime });
  }

  /** `{emoji}` reage (o mesmo emoji de novo ou `null` tira). */
  @Put(':id/messages/:messageId/reaction')
  react(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('messageId', new ParseUUIDPipe()) messageId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.conversations.react(actor.userId, id, messageId, b.emoji === undefined ? 'ausente' : b.emoji);
  }

  /** Apaga a própria mensagem para todos. */
  @Delete(':id/messages/:messageId')
  deleteMessage(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('messageId', new ParseUUIDPipe()) messageId: string) {
    return this.core.conversations.deleteMessage(actor.userId, id, messageId);
  }

  /** `{pinned?, muted?}`: fixar no topo e silenciar os avisos (só para você). */
  @Put(':id/preferences')
  preferences(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.conversations.setPreferences(actor.userId, id, { pinned: b.pinned, muted: b.muted });
  }

  /** Sinal de "digitando…". */
  @Post(':id/typing')
  @HttpCode(200)
  typing(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.conversations.typing(actor.userId, id);
  }

  /** Áudio de uma mensagem de voz. Exige o token (só quem está na conversa): o app baixa e toca a partir de um blob. */
  @Get(':id/messages/:messageId/audio')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async audio(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('messageId', new ParseUUIDPipe()) messageId: string) {
    const found = await this.core.conversations.audio(actor.userId, id, messageId);
    return new StreamableFile(found.data, { type: found.mime });
  }

  /** Quem recebeu o cartão aceita ou recusa o lugar (`{action: 'accept' | 'decline'}`). */
  @Post(':id/messages/:messageId/respond')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('messageId', new ParseUUIDPipe()) messageId: string, @Body() body: unknown) {
    return this.core.conversations.respond(actor.userId, id, messageId, asBody(body).action);
  }

  /** Detalhes do grupo (pessoas, eventos, mídia). 404 se não for um grupo seu. */
  @Post(':id/clear')
  @HttpCode(200)
  clear(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.conversations.clear(actor.userId, id);
  }

  @Post(':id/report')
  @HttpCode(200)
  report(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.conversations.report(actor.userId, id, b.reason, b.details);
  }

  @Get(':id/shared')
  shared(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.conversations.shared(actor.userId, id);
  }

  @Get(':id/group')
  group(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.conversations.group(actor.userId, id);
  }

  /** Sair do grupo. */
  @Post(':id/leave')
  @HttpCode(200)
  leave(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.conversations.leave(actor.userId, id);
  }

  /** Quem criou o grupo remove alguém. */
  @Delete(':id/members/:userId')
  removeMember(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.core.conversations.removeMember(actor.userId, id, userId);
  }

  /** `{userIds: string[]}`: adiciona amigos ao grupo. */
  @Post(':id/members')
  addMembers(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.conversations.addMembers(actor.userId, id, asBody(body).userIds);
  }

  /** `{admin: true|false}`: faz ou desfaz um administrador do grupo. */
  @Put(':id/members/:userId/admin')
  setAdmin(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('userId', new ParseUUIDPipe()) userId: string, @Body() body: unknown) {
    return this.core.conversations.setAdmin(actor.userId, id, userId, asBody(body).admin);
  }

  @Put(':id/group/name')
  renameGroup(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.core.conversations.renameGroup(actor.userId, id, asBody(body).name);
  }

  /** `{image: "data:image/jpeg;base64,..."}` (até 40 KB) ou `{image: null}` para remover. */
  @Put(':id/group/photo')
  groupPhoto(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.conversations.setGroupPhoto(actor.userId, id, b.image === undefined ? 'ausente' : b.image);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.conversations.markRead(actor.userId, id);
  }
}
