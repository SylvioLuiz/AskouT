import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { HunterBridge } from '../../core/hunter-bridge.ts';
import { syncFromHunter } from '../../core/hunter-sync.ts';
import type { AckResult, FeedItem, HunterFeed, SyncReport } from '../../core/hunter-sync.ts';
import { HUNTER_BRIDGE } from './hunter-token.ts';

const EVERY_MS = 10 * 60_000;

/** Lê do Hunter (HUNTER_URL + HUNTER_EXPORT_TOKEN, definidos só no servidor). Sem as duas variáveis, a busca fica inativa. */
export function httpFeed(baseUrl: string, token: string): HunterFeed {
  const base = baseUrl.replace(/\/+$/, '');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return {
    async fetchApproved(): Promise<FeedItem[]> {
      const res = await fetch(`${base}/export`, { headers, signal: AbortSignal.timeout(90_000) });
      if (!res.ok) throw new Error(`Hunter respondeu ${res.status}`);
      const json = (await res.json()) as { candidates?: FeedItem[] };
      return Array.isArray(json.candidates) ? json.candidates : [];
    },
    async ack(key: string, result: AckResult, ref?: string): Promise<void> {
      const res = await fetch(`${base}/export/ack`, { method: 'POST', headers, body: JSON.stringify({ key, result, ref }), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Hunter respondeu ${res.status} ao confirmar`);
    },
  };
}

/** A gestão busca no Hunter e publica sozinha, a cada 10 minutos, enquanto o Hunter estiver ligado na aba da gestão. */
@Injectable()
export class HunterSync implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly bridge: HunterBridge;
  private readonly log = new Logger('HunterSync');
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  last: (SyncReport & { error?: string }) | undefined;

  constructor(@Inject(HUNTER_BRIDGE) bridge: HunterBridge) {
    this.bridge = bridge;
  }

  get configured(): boolean {
    return !!process.env['HUNTER_URL'] && (process.env['HUNTER_EXPORT_TOKEN'] ?? '').length >= 32;
  }

  onApplicationBootstrap(): void {
    if (!this.configured) return;
    this.timer = setInterval(() => void this.run(), EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<(SyncReport & { error?: string }) | { error: string }> {
    if (!this.configured) return { error: 'Defina HUNTER_URL e HUNTER_EXPORT_TOKEN no servidor' };
    if (this.running) return this.last ?? { error: 'Já está buscando' };
    this.running = true;
    try {
      const report = await syncFromHunter(this.bridge, httpFeed(process.env['HUNTER_URL'] as string, process.env['HUNTER_EXPORT_TOKEN'] as string));
      this.last = report;
      if (report.seen > 0) this.log.log(`Busca no Hunter: ${JSON.stringify(report)}`);
      return report;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.last = { at: new Date().toISOString(), seen: 0, published: 0, review: 0, rejected: 0, stoppedDisabled: false, error };
      this.log.error(`Falha ao buscar no Hunter: ${error}`);
      return this.last;
    } finally {
      this.running = false;
    }
  }
}
