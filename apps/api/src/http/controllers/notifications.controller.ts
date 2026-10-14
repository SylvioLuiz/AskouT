import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

@Controller('notifications')
export class NotificationsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.core.notifications.list(actor.userId);
  }

  /** Só a contagem de não lidos (para a bolinha do sino). */
  @Get('unread')
  async unread(@CurrentActor() actor: Actor) {
    const [unread, latestUnreadAt] = await Promise.all([this.core.notifications.unreadCount(actor.userId), this.core.notifications.latestUnreadAt(actor.userId)]);
    return { unread, latestUnreadAt };
  }

  /** `{id}` marca um aviso; sem corpo, marca todos. */
  @Post('read')
  @HttpCode(200)
  read(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = body === undefined || body === null ? {} : asBody(body);
    return this.core.notifications.markRead(actor.userId, typeof b.id === 'string' ? b.id : undefined);
  }

  /** Chave pública VAPID (ou `null` se o push não está configurado). */
  @Get('push-key')
  pushKey() {
    return this.core.notifications.pushKey();
  }

  @Post('push')
  @HttpCode(200)
  subscribe(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.notifications.subscribe(actor.userId, { endpoint: b.endpoint, keys: b.keys });
  }

  @Post('push/remove')
  @HttpCode(200)
  unsubscribe(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.notifications.unsubscribe(actor.userId, asBody(body).endpoint);
  }
}
