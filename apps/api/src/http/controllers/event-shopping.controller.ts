import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import type { Core } from '../../core/index.ts';
import type { Actor } from '../../core/types.ts';
import { CurrentActor } from '../decorators.ts';
import { asBody } from '../support/parse.ts';
import { CORE } from '../tokens.ts';

/** Lista de compras e divisão de gastos dos eventos criados por pessoas (opcional por evento). */
@Controller()
export class EventShoppingController {
  private readonly core: Core;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  /** Ligada?, permissões, itens, gastos e a divisão (só para quem está no grupo do evento). */
  @Get('events/:id/shopping')
  @Header('Cache-Control', 'private, no-store')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.core.eventShopping.get(actor.userId, id);
  }

  /** `{enabled?, membersCanAdd?, membersCanCheck?}`: quem criou o evento liga ou desliga; quem administra muda as permissões. */
  @Put('events/:id/shopping')
  configure(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.eventShopping.configure(actor.userId, id, { enabled: b.enabled, membersCanAdd: b.membersCanAdd, membersCanCheck: b.membersCanCheck });
  }

  /** `{title, quantity?}` */
  @Post('events/:id/shopping/items')
  @HttpCode(200)
  addItem(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.eventShopping.addItem(actor.userId, id, { title: b.title, quantity: b.quantity });
  }

  /** `{title?, quantity?, bought?}` */
  @Patch('events/:id/shopping/items/:itemId')
  updateItem(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('itemId') itemId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.eventShopping.updateItem(actor.userId, id, itemId, { title: b.title, quantity: b.quantity, bought: b.bought });
  }

  @Delete('events/:id/shopping/items/:itemId')
  deleteItem(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('itemId') itemId: string) {
    return this.core.eventShopping.deleteItem(actor.userId, id, itemId);
  }

  /**
   * Anexo da divisão (nota fiscal, recibo): o corpo é o arquivo cru, com o `Content-Type` dele. `?nome=` é o nome do
   * arquivo e `?nota=` uma descrição curta.
   */
  @Post('events/:id/shopping/expenses/file')
  @HttpCode(200)
  attach(@CurrentActor() actor: Actor, @Param('id') id: string, @Headers('content-type') contentType: string | undefined, @Body() body: unknown, @Query('nome') name?: string, @Query('nota') note?: string) {
    const data = Buffer.isBuffer(body) ? new Uint8Array(body.buffer, body.byteOffset, body.byteLength) : undefined;
    return this.core.eventShopping.attach(actor.userId, id, { mime: contentType, data, name }, { note });
  }

  /** Só quem administra: gasto sem anexo. `{amountCents, payerId, note?}` */
  @Post('events/:id/shopping/expenses')
  @HttpCode(200)
  addExpense(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.eventShopping.addExpense(actor.userId, id, { amountCents: b.amountCents, payerId: b.payerId, note: b.note });
  }

  /** Só quem administra. `{amountCents?, payerId?, note?}` (`null` limpa). */
  @Patch('events/:id/shopping/expenses/:expenseId')
  updateExpense(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('expenseId') expenseId: string, @Body() body: unknown) {
    const b = asBody(body);
    return this.core.eventShopping.updateExpense(actor.userId, id, expenseId, { amountCents: b.amountCents, payerId: b.payerId, note: b.note });
  }

  @Delete('events/:id/shopping/expenses/:expenseId')
  deleteExpense(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('expenseId') expenseId: string) {
    return this.core.eventShopping.deleteExpense(actor.userId, id, expenseId);
  }

  /** O anexo de um gasto. Sempre baixa como arquivo (nunca abre como página do site). */
  @Get('events/:id/shopping/expenses/:expenseId/file')
  @Header('Cache-Control', 'private, max-age=86400')
  @Header('X-Content-Type-Options', 'nosniff')
  async file(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('expenseId', new ParseUUIDPipe()) expenseId: string) {
    const found = await this.core.eventShopping.expenseFile(actor.userId, id, expenseId);
    return new StreamableFile(found.data, { type: found.mime, disposition: `attachment; filename="arquivo"; filename*=UTF-8''${encodeURIComponent(found.name)}` });
  }

  /** Só quem administra: `{included: boolean}` põe ou tira a pessoa da divisão. */
  @Put('events/:id/shopping/split/:userId')
  setSplitMember(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('userId') userId: string, @Body() body: unknown) {
    return this.core.eventShopping.setSplitMember(actor.userId, id, userId, asBody(body).included);
  }
}
