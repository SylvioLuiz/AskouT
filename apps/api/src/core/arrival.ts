import { distanceMeters } from './geo.ts';

/**
 * "Chegada ao vivo" do NOW (como o carro chegando no Uber): quem libera deixa o amigo acompanhar, numa notificação
 * do celular que se atualiza sozinha, quanto falta para chegar. Aqui ficam as contas e o controle de quando
 * mandar uma atualização (para não disparar um aviso a cada posição recebida).
 */

/** A esta distância (ou menos) do alvo a pessoa é considerada chegada. */
export const ARRIVED_M = 80;
/** Intervalo mínimo entre duas atualizações do aviso (a não ser na chegada). */
export const ARRIVAL_MIN_INTERVAL_MS = 45_000;
/** Mesmo sem mudar o tempo estimado, atualiza ao menos a cada isto (o aviso mostra que ainda está valendo). */
export const ARRIVAL_REFRESH_MS = 3 * 60_000;

export interface ArrivalEstimate {
  distanceM: number;
  minutes: number;
  mode: 'walk' | 'car';
  arrived: boolean;
}

/**
 * Estimativa sem serviço de rotas (cada posição recebida chamaria um serviço externo): linha reta vezes 1,3 para
 * as curvas do caminho; até 2 km a pé (4,8 km/h), acima de carro na cidade (25 km/h).
 */
export function estimateArrival(from: { lat: number; lng: number }, to: { lat: number; lng: number }): ArrivalEstimate {
  const straight = distanceMeters(from, to);
  const arrived = straight <= ARRIVED_M;
  const walk = straight <= 2000;
  const path = straight * 1.3;
  const minutes = arrived ? 0 : Math.max(1, Math.ceil(path / (walk ? 80 : 417)));
  return { distanceM: Math.round(straight), minutes, mode: walk ? 'walk' : 'car', arrived };
}

/** 0 no começo do trajeto, 1 na chegada. Relativo à distância de quando a pessoa liberou (ou a maior já vista). */
export function arrivalProgress(startM: number, nowM: number): number {
  if (startM <= ARRIVED_M) return 1;
  const p = 1 - (nowM - ARRIVED_M) / (startM - ARRIVED_M);
  return Math.min(1, Math.max(0, Math.round(p * 100) / 100));
}

/** Distância em texto curto para a notificação. */
export function formatArrivalDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
}

interface TrackState {
  startM: number;
  sentAt: number;
  minutes: number;
  arrived: boolean;
}

/**
 * Lembra, por encontro e pessoa, a última atualização enviada. Fica só na memória do servidor: se ele reiniciar, a
 * próxima posição vira o novo começo do trajeto (a barra recomeça um pouco mais cheia, nada além disso).
 */
export class ArrivalTracker {
  private readonly states = new Map<string, TrackState>();

  /** Decide se esta posição merece atualizar o aviso. Devolve o progresso a mostrar, ou `undefined` para não enviar. */
  next(key: string, estimate: ArrivalEstimate, nowMs: number): { progress: number; first: boolean } | undefined {
    const prev = this.states.get(key);
    if (!prev) {
      this.states.set(key, { startM: Math.max(estimate.distanceM, ARRIVED_M), sentAt: nowMs, minutes: estimate.minutes, arrived: estimate.arrived });
      return { progress: arrivalProgress(estimate.distanceM, estimate.distanceM), first: true };
    }
    // Se afastou além do começo (mudou de caminho): o começo passa a ser a nova distância.
    if (estimate.distanceM > prev.startM) prev.startM = estimate.distanceM;
    const progress = arrivalProgress(prev.startM, estimate.distanceM);
    if (estimate.arrived) {
      if (prev.arrived) return undefined;
      Object.assign(prev, { sentAt: nowMs, minutes: 0, arrived: true });
      return { progress: 1, first: false };
    }
    const elapsed = nowMs - prev.sentAt;
    const changed = estimate.minutes !== prev.minutes || prev.arrived;
    if (elapsed < ARRIVAL_MIN_INTERVAL_MS || (!changed && elapsed < ARRIVAL_REFRESH_MS)) return undefined;
    Object.assign(prev, { sentAt: nowMs, minutes: estimate.minutes, arrived: false });
    return { progress, first: false };
  }

  /** Progresso de agora, sem contar como envio (para reabrir o aviso no iPhone). */
  current(key: string, estimate: ArrivalEstimate): number {
    const prev = this.states.get(key);
    if (!prev) return arrivalProgress(estimate.distanceM, estimate.distanceM);
    return arrivalProgress(Math.max(prev.startM, estimate.distanceM), estimate.distanceM);
  }

  forget(key: string): void {
    this.states.delete(key);
  }
}
