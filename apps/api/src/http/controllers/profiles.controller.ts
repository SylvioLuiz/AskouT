import { Body, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { asBody, parseIntParam } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller('profiles')
export class ProfilesController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  // As rotas fixas (search, me) vêm antes de ":username" para não serem capturadas por ele.
  @Get('search')
  search(@CurrentActor() actor: Actor, @Query('q') q: unknown, @Query('limit') limit: unknown) {
    return this.core.profiles.search(actor.userId, q, parseIntParam(limit));
  }

  @Patch('me')
  @HttpCode(200)
  updateOwn(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.profiles.updateOwn(actor.userId, { displayName: b.displayName, bio: b.bio, avatarUrl: b.avatarUrl });
  }

  @Patch('me/privacy')
  @HttpCode(200)
  setPrivacy(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.profiles.setPrivacy(actor.userId, asBody(body).isPrivate);
  }

  /** Esconde (`{hidden: true}`) ou mostra um selo no próprio perfil. */
  @Put('me/badges/:id')
  setBadgeHidden(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.badges.setHidden(actor, id, asBody(body).hidden);
  }

  /** `{image: "data:image/jpeg;base64,..."}` (até 60 KB, já reduzida pelo app) ou `{image: null}` para remover. */
  @Put('me/photo')
  setPhoto(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.profiles.setPhoto(actor.userId, b.image === undefined ? 'ausente' : b.image);
  }

  /** O próprio celular (privado). */
  @Get('me/phone')
  getPhone(@CurrentActor() actor: Actor) {
    return this.core.profiles.getPhone(actor.userId);
  }

  /** `{show}`: se o app deve pedir agora para cadastrar o celular (a conta não tem e o limite de pedidos deixa). */
  @Get('me/phone/prompt')
  phonePrompt(@CurrentActor() actor: Actor) {
    return this.core.profiles.phonePrompt(actor.userId);
  }

  /** O app mostrou o pedido de cadastro do celular. */
  @Post('me/phone/prompt')
  @HttpCode(200)
  markPhonePrompted(@CurrentActor() actor: Actor) {
    return this.core.profiles.markPhonePrompted(actor.userId);
  }

  /** `{phone: "(11) 98765-4321"}` guarda (normalizado para +55...); `{phone: null}` apaga. */
  @Put('me/phone')
  setPhone(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.profiles.setPhone(actor.userId, b.phone === undefined ? 0 : b.phone);
  }

  /** Eventos que a pessoa postou no perfil (perfil privado só para quem segue). */
  @Get(':username/events')
  events(@CurrentActor() actor: Actor, @Param('username') username: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.core.profileEvents.list(actor.userId, username, { limit, offset });
  }

  /** Presenças que a pessoa escolheu mostrar na aba Eventos (evento privado só para quem tem acesso a ele). */
  @Get(':username/going')
  going(@CurrentActor() actor: Actor, @Param('username') username: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.core.eventPages.listShownGoing(actor.userId, username, { limit, offset });
  }

  /** Aba "Participou": presenças que a pessoa não quis mostrar no perfil. Só ela mesma vê. */
  @Get(':username/attended')
  attended(@CurrentActor() actor: Actor, @Param('username') username: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.core.eventPages.listAttended(actor.userId, username, { limit, offset });
  }

  /** Denunciar um perfil. `{reason: SPAM|OFFENSIVE|NUDITY|VIOLENCE|FALSE_INFO|OTHER, details?}` */
  @Post(':username/report')
  @HttpCode(200)
  report(@CurrentActor() actor: Actor, @Param('username') username: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.profiles.report(actor.userId, username, b.reason, b.details);
  }

  @Get(':username')
  getByUsername(@CurrentActor() actor: Actor, @Param('username') username: string) {
    return this.core.profiles.getByUsername(actor.userId, username);
  }
}

/** Foto de perfil como imagem (usada em <img>, que não envia o token). Pública como em redes sociais; o endereço muda a cada troca. */
@Controller('users')
export class AvatarController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Public()
  @Get(':id/avatar')
  @Header('Cache-Control', 'public, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async avatar(@Param('id') id: string) {
    const photo = await this.core.profiles.photo(id);
    if (!photo) throw new NotFoundException();
    return new StreamableFile(photo.data, { type: photo.mime });
  }
}
