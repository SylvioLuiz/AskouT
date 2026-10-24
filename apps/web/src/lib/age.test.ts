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

test('showFlashCard: some para menor de 18, aparece para adulto e para quem ainda não informou a data', () => {
  assert.equal(showFlashCard(undefined, 10), false, 'idade ainda carregando: não mostra');
  assert.equal(showFlashCard({ adult: true, locked: false }, 10), true);
  assert.equal(showFlashCard({ adult: false, locked: false }, 10), true, 'sem data informada: precisa ver para liberar');
  assert.equal(showFlashCard({ adult: false, locked: true }, 10), false, 'consta como menor de 18');
});

test('showFlashCard: só aparece para quem segue pelo menos 3 pessoas', () => {
  const adult = { adult: true, locked: false };
  assert.equal(FLASH_CARD_MIN_FOLLOWING, 3);
  assert.equal(showFlashCard(adult, 0), false);
  assert.equal(showFlashCard(adult, 2), false);
  assert.equal(showFlashCard(adult, 3), true);
  assert.equal(showFlashCard(adult, 50), true);
  assert.equal(showFlashCard(adult, undefined), false, 'contagem ainda carregando (ou falhou): não mostra');
  assert.equal(showFlashCard({ adult: false, locked: true }, 50), false, 'menor de 18 não vê mesmo seguindo muita gente');
});

test('consentProblems: exige data válida, 13 anos ou mais e o aceite', () => {
  assert.deepEqual(consentProblems('1990-05-10', true, now), {});
  assert.ok(consentProblems('', true, now)['birthDate']);
  assert.ok(consentProblems('2020-01-01', true, now)['birthDate']);
  assert.ok(consentProblems('1990-05-10', false, now)['acceptTerms']);
  assert.equal(consentProblems('2013-10-22', true, now)['birthDate'], undefined, '13 anos hoje já vale');
});
