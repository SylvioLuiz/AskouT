import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Core } from '../core/index.ts';
import { CORE } from './tokens.ts';

const EVERY_MS = 5 * 60_000;

/** A cada 5 minutos: relê as agendas pessoais (Google e iCal) que não são lidas há 30 minutos. */
@Injectable()
export class CalendarSyncJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly core: Core;
  private readonly log = new Logger('CalendarSyncJob');
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
      const r = await this.core.calendarSync.runDue();
      if (r.synced > 0) this.log.log(`Agendas pessoais relidas: ${r.synced}`);
    } catch (error) {
      this.log.error(`Falha ao reler agendas pessoais: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
