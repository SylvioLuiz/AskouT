import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDateStats, dateRange, decideConfirmation, hasEnoughData, isDay, rankDates, tallyConfirmations } from './scheduling.ts';
import type { VoteRow } from './scheduling.ts';

const P = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
const v = (userId: string, date: string, status: VoteRow['status']): VoteRow => ({ userId, date, status });

test('dias: formato, existência e intervalo', () => {
  assert.equal(isDay('2026-10-15'), true);
  assert.equal(isDay('2026-02-31'), false);
  assert.equal(isDay('15/10/2026'), false);
  assert.deepEqual(dateRange('2026-10-30', '2026-11-02'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
});

test('compatibilidade usa só quem respondeu; cobertura usa todos os convidados', () => {
  const [s] = computeDateStats(['2026-10-16'], [v('a', '2026-10-16', 'YES'), v('b', '2026-10-16', 'MAYBE'), v('c', '2026-10-16', 'NO'), v('d', '2026-10-16', 'YES')], ['a', 'b', 'c', 'd']);
  assert.equal(s!.compatibility, 62.5); // (1+0.5+0+1)/4
  assert.equal(s!.coverage, 100);
  assert.deepEqual([s!.yes, s!.maybe, s!.no, s!.unanswered], [2, 1, 1, 0]);
  assert.equal(s!.level, 'ORANGE');
});

test('2 respostas positivas entre 10 convidados: 100% de compatibilidade, mas 20% de cobertura e cinza', () => {
  const [s] = computeDateStats(['2026-10-16'], [v('a', '2026-10-16', 'YES'), v('b', '2026-10-16', 'YES')], P);
  assert.equal(s!.compatibility, 100);
  assert.equal(s!.coverage, 20);
  assert.equal(s!.sufficient, false);
  assert.equal(s!.level, 'GRAY');
  assert.equal(s!.unanswered, 8);
});

test('sem resposta não é voto negativo; ninguém respondeu = sem nota e cinza', () => {
  const [s] = computeDateStats(['2026-10-16'], [], P);
  assert.equal(s!.compatibility, null);
  assert.equal(s!.level, 'GRAY');
  assert.equal(s!.unanswered, 10);
});

test('cores pelos limites (80 / 50) e limites configuráveis', () => {
  const day = '2026-10-16';
  const votes = (n: { yes: number; maybe: number; no: number }) => {
    const out: VoteRow[] = [];
    let i = 0;
    for (let k = 0; k < n.yes; k++) out.push(v(P[i++]!, day, 'YES'));
    for (let k = 0; k < n.maybe; k++) out.push(v(P[i++]!, day, 'MAYBE'));
    for (let k = 0; k < n.no; k++) out.push(v(P[i++]!, day, 'NO'));
    return out;
  };
  const level = (n: { yes: number; maybe: number; no: number }, th?: { green: number; orange: number; minCoverage: number }) => computeDateStats([day], votes(n), P.slice(0, 10), th)[0]!.level;
  assert.equal(level({ yes: 8, maybe: 0, no: 2 }), 'GREEN'); // 80%
  assert.equal(level({ yes: 7, maybe: 0, no: 3 }), 'ORANGE'); // 70%
  assert.equal(level({ yes: 5, maybe: 0, no: 5 }), 'ORANGE'); // 50%
  assert.equal(level({ yes: 4, maybe: 0, no: 6 }), 'RED'); // 40%
  assert.equal(level({ yes: 7, maybe: 0, no: 3 }, { green: 70, orange: 40, minCoverage: 50 }), 'GREEN');
});

test('voto de quem não é convidado é ignorado', () => {
  const [s] = computeDateStats(['2026-10-16'], [v('a', '2026-10-16', 'YES'), v('fora', '2026-10-16', 'YES')], ['a', 'b']);
  assert.equal(s!.answered, 1);
  assert.equal(s!.total, 2);
});

test('ranking: mais POSSO, menos NÃO, maior cobertura, menos TALVEZ, maior nota, data mais cedo', () => {
  const people = ['a', 'b', 'c', 'd'];
  const votes: VoteRow[] = [
    // 10: 3 sim, 1 não
    v('a', '2026-10-10', 'YES'), v('b', '2026-10-10', 'YES'), v('c', '2026-10-10', 'YES'), v('d', '2026-10-10', 'NO'),
    // 11: 3 sim, 0 não, 1 sem resposta  -> menos indisponíveis, ganha de 10
    v('a', '2026-10-11', 'YES'), v('b', '2026-10-11', 'YES'), v('c', '2026-10-11', 'YES'),
    // 12: 2 sim 2 talvez
    v('a', '2026-10-12', 'YES'), v('b', '2026-10-12', 'YES'), v('c', '2026-10-12', 'MAYBE'), v('d', '2026-10-12', 'MAYBE'),
    // 13: 2 sim 1 talvez (cobertura menor que 12)
    v('a', '2026-10-13', 'YES'), v('b', '2026-10-13', 'YES'), v('c', '2026-10-13', 'MAYBE'),
    // 14: igual a 13 (desempate pela data)
    v('a', '2026-10-14', 'YES'), v('b', '2026-10-14', 'YES'), v('c', '2026-10-14', 'MAYBE'),
    // 15: só não -> fora do ranking
    v('a', '2026-10-15', 'NO'),
  ];
  const stats = computeDateStats(dateRange('2026-10-10', '2026-10-15'), votes, people);
  assert.deepEqual(rankDates(stats).map((s) => s.date), ['2026-10-11', '2026-10-10', '2026-10-12', '2026-10-13', '2026-10-14']);
  // mesma entrada, ordem diferente: mesmo resultado
  const again = computeDateStats(dateRange('2026-10-10', '2026-10-15'), [...votes].reverse(), [...people].reverse());
  assert.deepEqual(rankDates(again).map((s) => s.date), rankDates(stats).map((s) => s.date));
});

test('dados suficientes: só com alguma data de cobertura suficiente', () => {
  const few = computeDateStats(['2026-10-16'], [v('a', '2026-10-16', 'YES')], P);
  assert.equal(hasEnoughData(rankDates(few)), false);
  const many = computeDateStats(['2026-10-16'], P.slice(0, 5).map((id) => v(id, '2026-10-16', 'YES')), P);
  assert.equal(hasEnoughData(rankDates(many)), true);
});

test('confirmação: unanimidade, maioria e manual', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const t = (m: Record<string, 'CONFIRMED' | 'ADJUST' | 'DECLINED'>) => tallyConfirmations(ids, new Map(Object.entries(m)));
  assert.equal(decideConfirmation('UNANIMITY', t({ a: 'CONFIRMED', b: 'CONFIRMED', c: 'CONFIRMED', d: 'CONFIRMED' })), 'FINALIZE');
  assert.equal(decideConfirmation('UNANIMITY', t({ a: 'CONFIRMED', b: 'CONFIRMED', c: 'CONFIRMED' })), 'WAIT');
  assert.equal(decideConfirmation('UNANIMITY', t({ a: 'CONFIRMED', d: 'DECLINED' })), 'REJECT');
  assert.equal(decideConfirmation('UNANIMITY', t({ a: 'CONFIRMED', d: 'ADJUST' })), 'WAIT');
  assert.equal(decideConfirmation('MAJORITY', t({ a: 'CONFIRMED', b: 'CONFIRMED' })), 'WAIT'); // 2 de 4 não é maioria
  assert.equal(decideConfirmation('MAJORITY', t({ a: 'CONFIRMED', b: 'CONFIRMED', c: 'CONFIRMED' })), 'FINALIZE');
  assert.equal(decideConfirmation('MAJORITY', t({ a: 'CONFIRMED', b: 'DECLINED', c: 'DECLINED' })), 'REJECT');
  assert.equal(decideConfirmation('MANUAL', t({ a: 'CONFIRMED', b: 'CONFIRMED', c: 'CONFIRMED', d: 'CONFIRMED' })), 'WAIT');
});

test('fuso: horário de São Paulo vira UTC e "hoje" respeita o fuso', async () => {
  const { todayIn, zonedTimeToUtc, isTimeZone } = await import('./scheduling.ts');
  assert.equal(zonedTimeToUtc('2026-11-07', '19:00', 'America/Sao_Paulo').toISOString(), '2026-11-07T22:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-11-07', '19:00', 'UTC').toISOString(), '2026-11-07T19:00:00.000Z');
  assert.equal(todayIn('America/Sao_Paulo', new Date('2026-11-07T01:30:00Z')), '2026-11-06');
  assert.equal(isTimeZone('America/Sao_Paulo'), true);
  assert.equal(isTimeZone('Marte/Olimpo'), false);
});
