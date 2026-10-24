import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageOnDate, birthDateProblem, consentProblems, FLASH_CARD_MIN_FOLLOWING, showFlashCard, todayIso } from './age.ts';

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

test('showFlashCard: só aparece para quem segue pelo menos 3 pessoas', () => {
  assert.equal(FLASH_CARD_MIN_FOLLOWING, 3);
  assert.equal(showFlashCard(0), false);
  assert.equal(showFlashCard(2), false);
  assert.equal(showFlashCard(3), true);
  assert.equal(showFlashCard(50), true);
  assert.equal(showFlashCard(undefined), false, 'contagem ainda carregando (ou falhou): não mostra');
});

test('consentProblems: exige data válida, 18 anos ou mais e o aceite', () => {
  assert.deepEqual(consentProblems('1990-05-10', true, now), {});
  assert.ok(consentProblems('', true, now)['birthDate']);
  assert.ok(consentProblems('2020-01-01', true, now)['birthDate']);
  assert.ok(consentProblems('2010-10-22', true, now)['birthDate'], '16 anos não vale');
  assert.ok(consentProblems('1990-05-10', false, now)['acceptTerms']);
  assert.equal(consentProblems('2008-10-22', true, now)['birthDate'], undefined, '18 anos hoje já vale');
});
