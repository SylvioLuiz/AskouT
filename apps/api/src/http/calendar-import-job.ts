import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Core } from '../core/index.ts';
import { CORE } from './tokens.ts';

const EVERY_MS = 5 * 60_000;

/** A cada 5 minutos: lê as agendas atrasadas, pede as aprovações que chegaram na hora e sobe o que foi aprovado. */
@Injectable()
export class CalendarImportJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly core: Core;
  private readonly log = new Logger('CalendarImportJob');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;

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
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.core.calendarImport.runDue();
      if (r.synced + r.notified + r.published > 0) this.log.log(`Agendas lidas: ${r.synced}, pedidos de aprovação: ${r.notified}, eventos publicados: ${r.published}`);
    } catch (error) {
      this.log.error(`Falha na importação de agendas: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
