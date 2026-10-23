import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, formatDateTime, plural, query } from './labels.ts';

test('query: ignora vazios, codifica e junta', () => {
  assert.equal(query({}), '');
  assert.equal(query({ q: '', status: undefined, events: false }), '');
  assert.equal(query({ q: 'zé & cia', offset: 25, events: true }), '?q=z%C3%A9%20%26%20cia&offset=25&events=true');
});

test('datas: inválidas viram traço; válidas saem em pt-BR sem ponto final', () => {
  assert.equal(formatDate(null), '—');
  assert.equal(formatDateTime('lixo'), '—');
  assert.ok(!formatDate('2026-10-14T12:00:00.000Z').includes('.'));
  assert.match(formatDate('2026-10-14T12:00:00.000Z'), /^14\b.*\bout\b.*2026$/);
  assert.match(formatDateTime('2026-10-14T15:30:00.000Z'), /^14\b.*\bout\b.*2026.*12:30$/);
});

test('plural', () => {
  assert.equal(plural(1, 'pedido', 'pedidos'), '1 pedido');
  assert.equal(plural(0, 'pedido', 'pedidos'), '0 pedidos');
});

test('formatBirthDate: não troca o dia por causa do fuso', async () => {
  const { formatBirthDate } = await import('./labels.ts');
  assert.equal(formatBirthDate('1990-01-01'), '01/01/1990');
  assert.equal(formatBirthDate(null), '—');
  assert.equal(formatBirthDate('lixo'), '—');
});
