import { dayOf } from './retention.ts';

// ---------------------------------------------------------------------------------------------
// Match: impulsionamento que só aparece para quem (1) mora no raio escolhido pelo responsável
// e (2) tem o gosto VALIDADO por uma das hashtags escolhidas (por exemplo #rock).
// Este arquivo guarda a regra, pura e sem banco, para ser fácil de testar e de ajustar.
// ---------------------------------------------------------------------------------------------

/** Raios que o responsável pode escolher, em km. A região da pessoa é aproximada em ~1 km, então menos que 2 km não faria sentido. */
export const MATCH_RADIUS_KM_OPTIONS: readonly number[] = [2, 5, 10, 25];
/** Quantas hashtags o responsável pode escolher. */
export const MATCH_MAX_TAGS = 5;

/**
 * REGRA DO GOSTO VALIDADO. Uma pessoa "gosta de #rock" quando, olhando só para o que ELA mesma fez
 * nos últimos 60 dias (curtir, comentar, compartilhar, confirmar presença ou ficar mais tempo que a própria média):
 *  1. mexeu com pelo menos 3 conteúdos diferentes com essa hashtag (um post só, mesmo muito curtido, não basta);
 *  2. em pelo menos 2 dias diferentes (uma maratona numa noite não vira gosto);
 *  3. a soma dos pesos (que envelhecem: valem metade a cada 30 dias) chega a 4;
 *  4. e o último gesto foi nos últimos 30 dias (o gosto não pode ser coisa antiga).
 * Só entram as 5 hashtags de maior peso de cada pessoa. O que os amigos curtem NÃO vale aqui: Match é sobre a própria pessoa.
 */
export const MATCH_MIN_CONTENTS = 3;
export const MATCH_MIN_DAYS = 2;
export const MATCH_MIN_WEIGHT = 4;
export const MATCH_RECENT_DAYS = 30;
export const MATCH_HALF_LIFE_DAYS = 30;
export const MATCH_MAX_INTERESTS = 5;

/** Menos pessoas que isto e o responsável não vê o número exato (evita descobrir quem é). */
export const MATCH_MIN_AUDIENCE = 10;
/** No máximo quantos anúncios Match aparecem de uma vez para a mesma pessoa. */
export const MATCH_MAX_PER_VIEW = 1;
/** Quantas pessoas a estimativa examina no máximo (o resto é ignorado, e a tela avisa). */
export const MATCH_ESTIMATE_SCAN = 1000;

/** Um gesto da pessoa sobre um conteúdo que tem hashtags. */
export interface InterestSignal {
  /** Identifica o conteúdo (por exemplo "POST:abc"), para contar conteúdos diferentes. */
  contentKey: string;
  at: Date;
  /** Peso do gesto (curtir 1,5; comentar 2; compartilhar e ir 2,5; tempo na tela de 1 a 2). */
  weight: number;
  tags: string[];
}

export interface ValidatedInterest {
  tag: string;
  weight: number;
  contents: number;
  days: number;
}

const decayBy = (at: Date, now: Date) => 0.5 ** (Math.max(0, now.getTime() - at.getTime()) / 86_400_000 / MATCH_HALF_LIFE_DAYS);

/** Aplica a regra acima e devolve os gostos validados, do mais forte para o mais fraco. */
export function validatedInterests(signals: readonly InterestSignal[], now: Date): ValidatedInterest[] {
  const byTag = new Map<string, { contents: Set<string>; days: Set<string>; weight: number; last: number }>();
  for (const s of signals) {
    for (const tag of new Set(s.tags)) {
      const t = byTag.get(tag) ?? { contents: new Set<string>(), days: new Set<string>(), weight: 0, last: 0 };
      t.contents.add(s.contentKey);
      t.days.add(dayOf(s.at));
      t.weight += s.weight * decayBy(s.at, now);
      t.last = Math.max(t.last, s.at.getTime());
      byTag.set(tag, t);
    }
  }
  const recentSince = now.getTime() - MATCH_RECENT_DAYS * 86_400_000;
  const out: ValidatedInterest[] = [];
  for (const [tag, t] of byTag) {
    if (t.contents.size < MATCH_MIN_CONTENTS || t.days.size < MATCH_MIN_DAYS || t.weight < MATCH_MIN_WEIGHT || t.last < recentSince) continue;
    out.push({ tag, weight: Math.round(t.weight * 100) / 100, contents: t.contents.size, days: t.days.size });
  }
  return out.sort((a, b) => b.weight - a.weight || (a.tag < b.tag ? -1 : 1)).slice(0, MATCH_MAX_INTERESTS);
}

/** Arredonda a coordenada para 2 casas (~1,1 km): a posição exata nunca é guardada. */
export function roundCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Quantas pessoas o responsável pode ver: abaixo de 10 não mostra número; acima, arredonda para baixo de 10 em 10. */
export function audienceBucket(count: number): { low: boolean; people: number | null; label: string } {
  if (count < MATCH_MIN_AUDIENCE) return { low: true, people: null, label: `menos de ${MATCH_MIN_AUDIENCE} pessoas` };
  const people = Math.floor(count / 10) * 10;
  return { low: false, people, label: `cerca de ${people} pessoas` };
}
