import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor, Public } from '../decorators.ts';
import type { AppConfig } from '../support/config.ts';
import { asBody } from '../support/parse.ts';
import { CONFIG, CORE } from '../tokens.ts';
import { appReturnUrl, backToAppPage } from './calendar-return-page.ts';

interface RedirectResponse {
  redirect(status: number, url: string): void;
  status(code: number): RedirectResponse;
  setHeader(name: string, value: string): unknown;
  send(body: string): void;
}

/**
 * Sincronizar agendas da pessoa: agenda do celular (enviada pelo app), link iCal e Google Agenda (OAuth).
 * Só horários ocupados; a agenda continua privada.
 */
@Controller()
export class CalendarsController {
  private readonly core: Core;
  private readonly config: AppConfig;

  constructor(@Inject(CORE) core: Core, @Inject(CONFIG) config: AppConfig) {
    this.core = core;
    this.config = config;
  }

  @Get('me/calendars')
  overview(@CurrentActor() actor: Actor) {
    return this.core.calendarSync.overview(actor.userId);
  }

  @Get('me/calendars/busy')
  busy(@CurrentActor() actor: Actor, @Query('from') from: unknown, @Query('to') to: unknown) {
    return this.core.calendarSync.busy(actor.userId, from, to);
  }

  @Put('me/calendars/device')
  saveDevice(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.calendarSync.saveDevice(actor.userId, asBody(body));
  }

  @Post('me/calendars/ics')
  addIcs(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.calendarSync.addIcs(actor.userId, asBody(body));
  }

  @Post('me/calendars/google/start')
  @HttpCode(200)
  googleStart(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.calendarSync.oauthStart(actor.userId, 'GOOGLE', asBody(body)['from']);
  }

  @Post('me/calendars/microsoft/start')
  @HttpCode(200)
  microsoftStart(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.core.calendarSync.oauthStart(actor.userId, 'MICROSOFT', asBody(body)['from']);
  }

  /** Endereços de retorno cadastrados no Google e na Microsoft. Quem chega aqui é o navegador, sem a sessão do app. */
  @Public()
  @Get('calendar/google/callback')
  async googleCallback(@Query('code') code: unknown, @Query('state') state: unknown, @Query('error') error: unknown, @Res() res: RedirectResponse) {
    await this.finish('GOOGLE', { code, state, error }, res);
  }

  @Public()
  @Get('calendar/microsoft/callback')
  async microsoftCallback(@Query('code') code: unknown, @Query('state') state: unknown, @Query('error') error: unknown, @Res() res: RedirectResponse) {
    await this.finish('MICROSOFT', { code, state, error }, res);
  }

  private async finish(provider: 'GOOGLE' | 'MICROSOFT', query: { code: unknown; state: unknown; error: unknown }, res: RedirectResponse) {
    const r = await this.core.calendarSync.oauthCallback(provider, query);
    const name = provider === 'GOOGLE' ? 'Google Agenda' : 'Outlook';
    if (r.from === 'app') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(r.ok ? 200 : 400).send(backToAppPage(r.ok, name, r.message, appReturnUrl(provider, r.ok, r.message)));
      return;
    }
    const q = new URLSearchParams(r.ok ? { agendas: provider.toLowerCase() } : { agendas: 'erro', motivo: r.message ?? '' });
    res.redirect(302, `${this.config.webBaseUrl}/agenda?${q.toString()}`);
  }

  @Put('me/calendars/:id/selection')
  setSelection(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.core.calendarSync.setSelection(actor.userId, id, asBody(body));
  }

  @Post('me/calendars/:id/sync')
  @HttpCode(200)
  syncNow(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.calendarSync.syncNow(actor.userId, id);
  }

  @Delete('me/calendars/:id')
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.core.calendarSync.remove(actor.userId, id);
  }
}
