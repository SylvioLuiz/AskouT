import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useUser } from '../auth.tsx';
import { api } from '../client.ts';
import { BoostStatQueue, SPONSORED_VIEW_MS } from '../lib/boost-stats.ts';
import type { BoostPlacement, BoostStatEntry } from '../lib/boost-stats.ts';

const queue = new BoostStatQueue();
let owner: string | undefined;
let day = '';
let interval: ReturnType<typeof setInterval> | undefined;
let listening = false;

/** Manda em lote. Se falhar, descarta: o relatório do anúncio nunca pode atrapalhar o uso. */
function flush(): void {
  const batch = queue.drain();
  if (batch.length === 0) return;
  void api.trackBoostStats(batch).catch(() => undefined);
  if (queue.size > 0) setTimeout(flush, 500);
}

function ensureScheduler(): void {
  if (!interval) interval = setInterval(flush, 10_000);
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

/** Troca de conta ou de dia: o servidor conta de novo, então a aba também pode mandar de novo. */
function enqueue(userId: string | undefined, entry: BoostStatEntry): void {
  const today = new Date().toDateString();
  if ((userId !== undefined && owner !== userId) || day !== today) {
    flush();
    queue.reset();
    if (userId !== undefined) owner = userId;
    day = today;
  }
  ensureScheduler();
  queue.add(entry);
}

/** Alvo do cartão patrocinado: o evento (quando há) ou o local. */
export interface SponsoredTarget {
  eventId?: string | undefined;
  venueId?: string | undefined;
}

function entry(kind: BoostStatEntry['kind'], placement: BoostPlacement, target: SponsoredTarget): BoostStatEntry {
  return { kind, placement, ...(target.eventId ? { eventId: target.eventId } : {}), ...(target.venueId ? { venueId: target.venueId } : {}) };
}

/**
 * Conta uma exibição do cartão patrocinado quando ele fica pelo menos 60% visível por 1 segundo, com a aba aberta.
 * Com `active` falso (cartão que não é patrocinado) não faz nada. `shared` reaproveita um ref que o cartão já usa.
 */
export function useSponsoredView<T extends Element>(active: boolean, placement: BoostPlacement, target: SponsoredTarget, shared?: RefObject<T | null>): RefObject<T | null> {
  const own = useRef<T | null>(null);
  const ref = shared ?? own;
  const me = useUser().profile.userId;
  const { eventId, venueId } = target;
  useEffect(() => {
    const node = ref.current;
    if (!active || !node || typeof IntersectionObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inView = false;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const maybeStart = () => {
      if (!inView || document.visibilityState !== 'visible' || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        enqueue(me, entry('IMPRESSION', placement, { eventId, venueId }));
      }, SPONSORED_VIEW_MS);
    };
    const watcher = new IntersectionObserver(
      (entries) => {
        inView = entries.some((e) => e.isIntersecting);
        if (inView) maybeStart();
        else stop();
      },
      { threshold: 0.6 },
    );
    const onVisibility = () => (document.visibilityState === 'visible' ? maybeStart() : stop());
    watcher.observe(node);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      watcher.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, me, placement, eventId, venueId, ref]);
  return ref;
}

/** A pessoa abriu o cartão patrocinado. */
export function trackSponsoredOpen(placement: BoostPlacement, target: SponsoredTarget): void {
  enqueue(undefined, entry('OPEN', placement, target));
  flush();
}

/** A pessoa tocou em "Comprar ingresso" (o servidor só conta se ela viu o anúncio hoje ou ontem). */
export function trackTicketClick(eventId: string): void {
  enqueue(undefined, entry('TICKET', 'EVENT_PAGE', { eventId }));
  flush();
}
