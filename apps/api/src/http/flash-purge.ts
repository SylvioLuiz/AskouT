import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Core } from '../core/index.ts';
import { CORE } from './tokens.ts';

const EVERY_MS = 60_000;

/**
 * Limpeza periódica do Flash: convites vencidos são encerrados e posições órfãs apagadas.
 * Além disso, tudo é conferido na leitura, então este job só garante que nada fique parado no banco.
 */
@Injectable()
export class FlashPurge implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly core: Core;
  private readonly log = new Logger('FlashPurge');
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(@Inject(CORE) core: Core) {
    this.core = core;
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      const result = await this.core.flash.purgeExpired();
      if (result.invites + result.positions + result.removed > 0) this.log.log(`Limpeza: ${JSON.stringify(result)}`);
    } catch (error) {
      this.log.error(`Falha na limpeza do Flash: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
