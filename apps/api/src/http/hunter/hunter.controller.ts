import { timingSafeEqual } from 'node:crypto';
import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Inject, Param, Patch, Post, Query, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { HunterBridge } from '../../core/hunter-bridge.ts';
import type { HunterRefusal } from '../../core/hunter-bridge.ts';
import { forbidden } from '../../core/errors.ts';
import type { Actor } from '../../core/types.ts';
import { createHash } from 'node:crypto';
import { CurrentActor, Public } from '../decorators.ts';
import { asBody, bearerToken, parseIntParam } from '../support/parse.ts';
import { PRISMA } from '../tokens.ts';
import { PrismaHunterStore } from './prisma-hunter-store.ts';
import { HunterSync } from './hunter-feed.ts';

import { HUNTER_BRIDGE } from './hunter-token.ts';
export { HUNTER_BRIDGE };

/** Cria a ponte. O token vem só do ambiente do servidor (HUNTER_SERVICE_TOKEN, mínimo de 32 caracteres). */
export const hunterBridgeProvider = {
  provide: HUNTER_BRIDGE,
  inject: [PRISMA],
  useFactory: (prisma: PrismaClient): HunterBridge => {
    const raw = process.env['HUNTER_SERVICE_TOKEN'];
    return new HunterBridge({
      store: new PrismaHunterStore(prisma),
      serviceToken: raw && raw.length >= 32 ? raw : undefined,
      clock: { now: () => new Date() },
      newEventId: (ref) => {
        const h = createHash('md5').update(`askout-hunter:${ref}`).digest('hex');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      },
    });
  },
};

function sameToken(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Recusa com a resposta certa quando a regra de propriedade ou o interruptor barraram a operação. */
function refuse(refusal: HunterRefusal): never {
  if (refusal === 'DUPLICATE') throw new ConflictException({ code: 'HUNTER_DUPLICATE', message: 'Já existe um evento com o mesmo título, local e dia' });
  if (refusal === 'DISABLED') throw new ServiceUnavailableException({ code: 'HUNTER_DISABLED', message: 'O Hunter está desligado' });
  throw new ForbiddenException({ code: `HUNTER_${refusal}`, message: refusal === 'OWNED' ? 'O local tem responsável' : refusal === 'CLAIM_PENDING' ? 'Há um pedido de reivindicação pendente' : 'Local não encontrado ou situação desconhecida' });
}

/** Endpoints de serviço: só o Hunter chama, com o token de serviço (nunca um usuário). Rotas abertas ao guard global, fechadas aqui. */
@Controller('hunter')
export class HunterServiceController {
  private readonly bridge: HunterBridge;

  constructor(@Inject(HUNTER_BRIDGE) bridge: HunterBridge) {
    this.bridge = bridge;
  }

  private auth(header: unknown): void {
    const expected = this.bridge.serviceToken;
    if (!expected) throw new ServiceUnavailableException({ code: 'HUNTER_NOT_CONFIGURED', message: 'Ponte do Hunter não configurada' });
    const given = bearerToken(header);
    if (!given || !sameToken(given, expected)) throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Credencial inválida' });
  }

  @Public()
  @Get('status')
  async status(@Headers('authorization') authorization: string | undefined) {
    this.auth(authorization);
    return { enabled: await this.bridge.isEnabled() };
  }

  @Public()
  @Get('venues')
  async venues(@Headers('authorization') authorization: string | undefined, @Query() q: { externalKey?: unknown; q?: unknown; lat?: unknown; lng?: unknown }) {
    this.auth(authorization);
    return this.bridge.lookupVenues(q);
  }

  @Public()
  @Get('regions')
  async regions(@Headers('authorization') authorization: string | undefined, @Query('minUsers') minUsers: unknown) {
    this.auth(authorization);
    return this.bridge.regions(minUsers);
  }

  @Public()
  @Post('events')
  @HttpCode(200)
  async create(@Headers('authorization') authorization: string | undefined, @Body() body: unknown) {
    this.auth(authorization);
    const r = await this.bridge.create(asBody(body));
    if (!r.ok) refuse(r.refusal);
    return { eventId: r.eventId, created: r.created };
  }

  @Public()
  @Get('events/:ref')
  async event(@Headers('authorization') authorization: string | undefined, @Param('ref') ref: string) {
    this.auth(authorization);
    return this.bridge.status(ref);
  }

  @Public()
  @Patch('events/:ref')
  async update(@Headers('authorization') authorization: string | undefined, @Param('ref') ref: string, @Body() body: unknown) {
    this.auth(authorization);
    const r = await this.bridge.update(ref, asBody(body));
    if (!r.ok) refuse(r.refusal);
    return { eventId: r.eventId };
  }

  @Public()
  @Post('events/:ref/cancel')
  @HttpCode(200)
  async cancel(@Headers('authorization') authorization: string | undefined, @Param('ref') ref: string) {
    this.auth(authorization);
    const r = await this.bridge.cancel(ref);
    if (!r.ok) refuse(r.refusal);
    return { removed: r.removed };
  }
}

function assertAdmin(actor: Actor): void {
  if (actor.role !== 'ADMIN') throw forbidden('Só a gestão pode fazer isso');
}

/** Gestão da ponte: aba "Hunter" do painel de gestão do AskouT. Exige conta ADMIN (o guard global já autenticou). */
@Controller('admin/hunter')
export class HunterAdminController {
  private readonly bridge: HunterBridge;

  private readonly sync: HunterSync;

  constructor(@Inject(HUNTER_BRIDGE) bridge: HunterBridge, @Inject(HunterSync) sync: HunterSync) {
    this.bridge = bridge;
    this.sync = sync;
  }

  @Get()
  async overview(@CurrentActor() actor: Actor, @Query() q: { limit?: unknown; offset?: unknown }) {
    assertAdmin(actor);
    return { ...(await this.bridge.adminOverview(Math.min(parseIntParam(q.limit) ?? 50, 100), parseIntParam(q.offset) ?? 0)), feedConfigured: this.sync.configured, lastSync: this.sync.last ?? null };
  }

  /** Busca agora no Hunter o que foi aprovado e publica (o mesmo que roda sozinho a cada 10 minutos). */
  @Post('sync')
  @HttpCode(200)
  async syncNow(@CurrentActor() actor: Actor) {
    assertAdmin(actor);
    const result = await this.sync.run();
    await this.bridge.auditSync(actor.userId, result);
    return result;
  }

  @Post('enabled')
  @HttpCode(200)
  setEnabled(@CurrentActor() actor: Actor, @Body() body: unknown) {
    assertAdmin(actor);
    return this.bridge.setEnabled(actor.userId, asBody(body).enabled);
  }

  @Delete('events')
  removeAll(@CurrentActor() actor: Actor) {
    assertAdmin(actor);
    return this.bridge.adminRemove(actor.userId, undefined);
  }

  @Delete('events/:ref')
  removeOne(@CurrentActor() actor: Actor, @Param('ref') ref: string) {
    assertAdmin(actor);
    return this.bridge.adminRemove(actor.userId, ref);
  }
}
