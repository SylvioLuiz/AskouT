import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor, Public } from '../decorators.ts';
import type { AppConfig } from '../support/config.ts';
import { asBody } from '../support/parse.ts';
import { CONFIG, CORE } from '../tokens.ts';

interface RedirectResponse {
  redirect(status: number, url: string): void;
  status(code: number): RedirectResponse;
  setHeader(name: string, value: string): unknown;
  send(body: string): void;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Página curta para quem ligou a Google Agenda pelo app: o login abriu no navegador do celular, então é só voltar ao app. */
function backToAppPage(ok: boolean, message: string | undefined): string {
  const title = ok ? 'Google Agenda ligada' : 'Não deu certo';
  const text = ok ? 'Pronto! Pode voltar ao AskouT: seus horários ocupados já aparecem na agenda.' : message ?? 'Tente de novo pelo app.';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;box-sizing:border-box;background:#fff;color:#1d1d1f;text-align:center}@media(prefers-color-scheme:dark){body{background:#111;color:#f5f5f7}}h1{font-size:1.4rem}p{max-width:22rem;line-height:1.5}</style>
</head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p></main></body></html>`;
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
    return this.core.calendarSync.googleStart(actor.userId, asBody(body)['from']);
  }

  /** Endereço de retorno cadastrado no Google (GOOGLE_CALENDAR_REDIRECT_URI). Quem chega aqui é o navegador, sem a sessão do app. */
  @Public()
  @Get('calendar/google/callback')
  async googleCallback(@Query('code') code: unknown, @Query('state') state: unknown, @Query('error') error: unknown, @Res() res: RedirectResponse) {
    const r = await this.core.calendarSync.googleCallback({ code, state, error });
    if (r.from === 'app') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(r.ok ? 200 : 400).send(backToAppPage(r.ok, r.message));
      return;
    }
    const base = this.config.googleCalendar?.webBaseUrl ?? 'https://askout.com.br';
    const q = new URLSearchParams(r.ok ? { agendas: 'google' } : { agendas: 'erro', motivo: r.message ?? '' });
    res.redirect(302, `${base}/agenda?${q.toString()}`);
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
