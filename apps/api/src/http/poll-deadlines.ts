import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Core } from '../core/index.ts';
import { CORE } from './tokens.ts';

const EVERY_MS = 60_000;

/** Avisa, a cada minuto, as votações de data cujo prazo acabou (uma vez por votação). */
@Injectable()
export class PollDeadlines implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly core: Core;
  private readonly log = new Logger('PollDeadlines');
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
      const n = await this.core.scheduling.notifyDeadlines();
      if (n > 0) this.log.log(`Prazos de votação avisados: ${n}`);
    } catch (error) {
      this.log.error(`Falha ao avisar prazos de votação: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
