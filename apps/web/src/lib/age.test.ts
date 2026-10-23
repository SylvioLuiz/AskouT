import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOnDate, birthDateProblem, todayIso } from './age.ts';

const now = new Date(2026, 9, 22, 12);

test('ageOnDate: conta o aniversário no próprio dia e rejeita datas que não existem', () => {
  assert.equal(ageOnDate('2008-10-22', now), 18);
  assert.equal(ageOnDate('2008-10-23', now), 17);
  assert.equal(ageOnDate('2001-02-30', now), -1);
  assert.equal(ageOnDate('22/10/2000', now), -1);
});

test('birthDateProblem: vazio, futuro e antigo demais dão erro', () => {
  assert.ok(birthDateProblem('', now));
  assert.ok(birthDateProblem('2030-01-01', now));
  assert.ok(birthDateProblem('1800-01-01', now));
  assert.equal(birthDateProblem('1990-05-10', now), undefined);
});

test('todayIso: formata com zeros', () => {
  assert.equal(todayIso(new Date(2026, 0, 5)), '2026-01-05');
});
