import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/**
 * Grupos de amigos: a pessoa só entra aceitando o convite, e os eventos criados no grupo já convidam todos.
 * O id é o da conversa do grupo; mensagens, nome, foto, sair, remover e administradores ficam em `/conversations/:id`.
 */
@Controller('groups')
export class GroupsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Seus grupos (`items`) e os convites que você ainda não respondeu (`invites`). */
  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.core.communities.list(actor.userId);
  }

  /** `{name, memberIds?, shareHistory?}`: cria o grupo e convida os amigos escolhidos. */
  @Post()
  create(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.communities.create(actor.userId, { name: b.name, memberIds: b.memberIds, shareHistory: b.shareHistory });
  }

  /** Página do grupo: eventos e, para quem administra, convites pendentes. Só quem está no grupo. */
  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.communities.get(actor.userId, id);
  }

  /** `{userIds, shareHistory?}`: convida amigos (quem administra). Entram só quando aceitarem. */
  @Post(':id/invites')
  invite(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.communities.invite(actor.userId, id, { userIds: b.userIds, shareHistory: b.shareHistory });
  }

  @Delete(':id/invites/:userId')
  cancelInvite(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Param('userId', new ParseUUIDPipe()) userId: string) {
    return this.core.communities.cancelInvite(actor.userId, id, userId);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.communities.accept(actor.userId, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.core.communities.decline(actor.userId, id);
  }
}
