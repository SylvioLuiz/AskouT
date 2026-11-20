/**
 * "Pessoas que você talvez conheça": várias fontes somadas num placar, como nos apps de rede social. Cada sinal vale
 * um peso e tem um teto, para nenhum sozinho dominar a lista. Os pesos ficam aqui, num lugar só.
 *
 * Quem entra na lista (candidatos): amigos de amigos, quem confirmou presença nos mesmos eventos de local que você e
 * quem já segue você. Os gostos em comum só somam ponto para quem já é candidato.
 */
export const PEOPLE_WEIGHTS = {
  /** Cada amigo em comum. */
  mutual: 3,
  mutualCap: 6,
  /** Cada evento de local em que as duas pessoas confirmaram presença. */
  sharedEvent: 2,
  sharedEventCap: 4,
  /** A pessoa já segue você e você ainda não a segue. */
  followsYou: 5,
  /** Cada gosto de rolê em comum. */
  sharedTaste: 1,
  sharedTasteCap: 3,
} as const;

/** Quantas sugestões a lista traz. */
export const PEOPLE_MAX_ITEMS = 20;
/** Quantos amigos, eventos e seguidores entram na conta (limite de custo). */
export const PEOPLE_MAX_FRIENDS = 100;
export const PEOPLE_MAX_EVENTS = 20;
export const PEOPLE_MAX_ATTENDEES_PER_EVENT = 200;
export const PEOPLE_MAX_FOLLOWERS = 200;

/** Motivo principal que o app mostra no cartão. */
export type PeopleReason = 'MUTUAL' | 'FOLLOWS_YOU' | 'EVENTS' | 'TASTES';

export interface PeopleSignals {
  mutualCount: number;
  sharedEvents: number;
  followsYou: boolean;
  sharedTastes: number;
}

export interface PeopleScore {
  score: number;
  reason: PeopleReason;
}

/** Placar de um candidato e o motivo que mais pesou (empate: amigos em comum, depois segue você, eventos, gostos). */
export function scorePerson(s: PeopleSignals): PeopleScore {
  const w = PEOPLE_WEIGHTS;
  const parts: [PeopleReason, number][] = [
    ['MUTUAL', Math.min(s.mutualCount * w.mutual, w.mutualCap * w.mutual)],
    ['FOLLOWS_YOU', s.followsYou ? w.followsYou : 0],
    ['EVENTS', Math.min(s.sharedEvents, w.sharedEventCap) * w.sharedEvent],
    ['TASTES', Math.min(s.sharedTastes, w.sharedTasteCap) * w.sharedTaste],
  ];
  const score = parts.reduce((sum, [, v]) => sum + v, 0);
  let best = parts[0] as [PeopleReason, number];
  for (const part of parts) if (part[1] > best[1]) best = part;
  return { score, reason: best[0] };
}
