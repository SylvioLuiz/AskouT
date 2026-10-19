import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeFilterCount, coverShape, effectiveQuery, rangeFor, safeImage } from './explore.ts';

const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
// Quarta-feira, 14/out/2026, 18:00
const WED = new Date(2026, 9, 14, 18, 0);

test('rangeFor: hoje, amanhã e semana no horário local', () => {
  const today = rangeFor('today', WED);
  assert.equal(today.from.getTime(), WED.getTime());
  assert.equal(ymd(today.to), '2026-10-15');
  const tomorrow = rangeFor('tomorrow', WED);
  assert.equal(ymd(tomorrow.from), '2026-10-15');
  assert.equal(tomorrow.from.getHours(), 0);
  assert.equal(ymd(tomorrow.to), '2026-10-16');
  const week = rangeFor('week', WED);
  assert.equal(ymd(week.to), '2026-10-19'); // próxima segunda
  assert.equal(week.from.getTime(), WED.getTime());
});

test('rangeFor: fim de semana, próxima semana e mês', () => {
  const weekend = rangeFor('weekend', WED);
  assert.equal(ymd(weekend.from), '2026-10-17');
  assert.equal(ymd(weekend.to), '2026-10-19');
  const saturday = new Date(2026, 9, 17, 15, 0);
  assert.equal(rangeFor('weekend', saturday).from.getTime(), saturday.getTime());
  const next = rangeFor('nextweek', WED);
  assert.equal(ymd(next.from), '2026-10-19');
  assert.equal(ymd(next.to), '2026-10-26');
  assert.equal(ymd(rangeFor('month', WED).to), '2026-11-1');
  const sunday = new Date(2026, 9, 18, 10, 0);
  assert.equal(ymd(rangeFor('week', sunday).to), '2026-10-19');
  assert.equal(ymd(rangeFor('nextweek', sunday).from), '2026-10-19');
});

test('todos os períodos têm no máximo 62 dias e fim depois do começo', () => {
  for (const id of ['today', 'tomorrow', 'week', 'weekend', 'nextweek', 'month', 'any'] as const) {
    const { from, to } = rangeFor(id, WED);
    assert.ok(to > from, id);
    assert.ok(to.getTime() - from.getTime() <= 62 * 86_400_000, id);
  }
});

test('effectiveQuery: poucas letras voltam ao que está perto', () => {
  assert.equal(effectiveQuery(' a '), '');
  assert.equal(effectiveQuery('ba'), 'ba');
  assert.equal(effectiveQuery('#'), '');
  assert.equal(effectiveQuery('#s'), '#s');
});

test('coverShape é estável; safeImage só aceita https; contagem de filtros', () => {
  assert.equal(coverShape('abc'), coverShape('abc'));
  assert.equal(safeImage('http://x/y.png'), null);
  assert.equal(safeImage('https://x/y.png'), 'https://x/y.png');
  assert.equal(safeImage(null), null);
  assert.equal(activeFilterCount({ range: 'today', kind: null, free: false, radiusKm: 10 }), 0);
  assert.equal(activeFilterCount({ range: 'week', kind: 'SHOW', free: true, radiusKm: 5 }), 4);
  assert.equal(activeFilterCount({ range: 'week', kind: null, free: false, radiusKm: 10, hot: true }), 1, 'Bombando conta uma vez e ignora o período');
});

test('safeImage aceita capas servidas pela API com o endereço base', async () => {
  const { safeImage, setAssetBase } = await import('./explore.ts');
  setAssetBase('/api');
  assert.equal(safeImage('/place-events/a1/cover?v=5'), '/api/place-events/a1/cover?v=5');
  assert.equal(safeImage('/etc/passwd'), null);
  assert.equal(safeImage('http://x.com/a.jpg'), null);
  assert.equal(safeImage('https://x.com/a.jpg'), 'https://x.com/a.jpg');
  setAssetBase('');
});
