import { Body, Controller, Get, Header, HttpCode, Inject, NotFoundException, Param, Patch, Put, Query, StreamableFile } from '@nestjs/common';
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

  /** `{image: "data:image/jpeg;base64,..."}` (até 60 KB, já reduzida pelo app) ou `{image: null}` para remover. */
  @Put('me/photo')
  setPhoto(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.profiles.setPhoto(actor.userId, b.image === undefined ? 'ausente' : b.image);
  }

  /** Eventos que a pessoa postou no perfil (perfil privado só para quem segue). */
  @Get(':username/events')
  events(@CurrentActor() actor: Actor, @Param('username') username: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.core.profileEvents.list(actor.userId, username, { limit, offset });
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
