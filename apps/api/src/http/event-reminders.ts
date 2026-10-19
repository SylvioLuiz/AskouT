import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Core } from '../core/index.ts';
import { CORE } from './tokens.ts';

const EVERY_MS = 60_000;

/** A cada minuto, manda o push "seu evento começa em 30 minutos" para quem confirmou presença. */
@Injectable()
export class EventReminders implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly core: Core;
  private readonly log = new Logger('EventReminders');
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
      const n = await this.core.eventReminders.sendDue();
      if (n > 0) this.log.log(`Lembretes de evento enviados: ${n}`);
    } catch (error) {
      this.log.error(`Falha ao enviar lembretes de evento: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
