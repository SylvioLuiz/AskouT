import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import type { Core } from '../core/index.ts';
import { CORE } from './tokens.ts';

const EVERY_MS = 2 * 60_000;

/**
 * A cada 2 minutos: abre o álbum dos eventos que acabaram de começar (com quem confirmou presença) e manda o aviso
 * "Ontem em Bar X com 4 amigos" no dia seguinte, a partir das 10 h. Cada pessoa recebe o aviso uma vez só.
 */
@Injectable()
export class AlbumJobs implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly core: Core;
  private readonly log = new Logger('AlbumJobs');
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
      await this.core.albums.syncEvents();
      const n = await this.core.albums.sendSummaries();
      if (n > 0) this.log.log(`Resumos do dia seguinte enviados: ${n}`);
    } catch (error) {
      this.log.error(`Falha nos álbuns dos encontros: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
