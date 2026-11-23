import { Body, Controller, Get, HttpCode, Inject, Post, Put, Query } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor, Public } from '../decorators.ts';
import { validationError } from '../../core/errors.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

const PUSH_TEST_DELAY_MS = 5000;

@Controller('notifications')
export class NotificationsController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** `?category=mentions|comments|likes|follows|invites|events|messages` filtra a lista (sem ela, ou `all`, vem tudo). */
  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: { category?: unknown }) {
    return this.core.notifications.list(actor.userId, q.category);
  }

  /** Só a contagem de não lidos (para a bolinha do sino). */
  @Get('unread')
  async unread(@CurrentActor() actor: Actor) {
    const [unread, latestUnreadAt] = await Promise.all([this.core.notifications.unreadCount(actor.userId), this.core.notifications.latestUnreadAt(actor.userId)]);
    return { unread, latestUnreadAt };
  }

  /** `{id}` marca um aviso; `{ids: [...]}` marca os selecionados; sem corpo, marca todos. */
  @Post('read')
  @HttpCode(200)
  read(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = body === undefined || body === null ? {} : asBody(body);
    if (b.ids !== undefined) {
      if (!Array.isArray(b.ids)) throw validationError('Dados inválidos', { ids: 'Envie uma lista de avisos' });
      return this.core.notifications.markRead(actor.userId, b.ids as string[]);
    }
    return this.core.notifications.markRead(actor.userId, typeof b.id === 'string' ? b.id : undefined);
  }

  /**
   * Manda um aviso de teste para os aparelhos de quem pediu e devolve quantos foram aceitos. Espera 5 s antes de enviar:
   * com o app aberto o celular não mostra a notificação, então dá tempo de minimizar o app para ver a prévia chegar.
   */
  @Post('push/test')
  @HttpCode(200)
  async testPush(@CurrentActor() actor: Actor) {
    await new Promise((resolve) => setTimeout(resolve, PUSH_TEST_DELAY_MS));
    return this.core.notifications.testPush(actor.userId);
  }

  /** O que está silenciado: `{all, chats, events}`. */
  @Get('settings')
  settings(@CurrentActor() actor: Actor) {
    return this.core.notifications.muteSettings(actor.userId);
  }

  /** `{all?, chats?, events?}`: muda só o que vier. */
  @Put('settings')
  setSettings(@CurrentActor() actor: Actor, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.notifications.setMuteSettings(actor.userId, { all: b.all, chats: b.chats, events: b.events });
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
    return this.core.notifications.subscribe(actor.userId, { endpoint: b.endpoint, keys: b.keys, reply: b.reply });
  }

  @Post('push/remove')
  @HttpCode(200)
  unsubscribe(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.notifications.unsubscribe(actor.userId, asBody(body).endpoint);
  }

  /**
   * "Responder" direto na notificação do app (iPhone/Android), sem abrir o app: `{token, body}`. Sem login,
   * porque quem chama é o código nativo do aviso; o `token` veio no próprio push e só vale para aquela conversa,
   * naquele aparelho (ver NotificationService.replier).
   */
  /**
   * Live Activity da chegada no iPhone: o app registra o token da atividade que acabou de abrir. Sem login (o
   * iPhone pode abrir o app em segundo plano só para isso); `registration` veio dentro da própria atividade.
   */
  @Public()
  @Post('push/live-activity')
  @HttpCode(200)
  liveActivity(@Body() body: unknown) {
    const b = asBody(body);
    return this.core.notifications.registerLiveActivity(b.registration, b.token);
  }

  @Public()
  @Post('push/reply')
  @HttpCode(200)
  async reply(@Body() body: unknown) {
    const b = asBody(body);
    const message = await this.core.replyFromPush(b.token, b.body);
    return { ok: true, id: message.id };
  }
}
