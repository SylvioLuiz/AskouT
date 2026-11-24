import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { balanceLabel, centsToInput, expenseFileCheck, formatCents, parseMoney, shoppingSummary } from './event-shopping.ts';

describe('lista de compras e divisão', () => {
  it('lê valores no jeito brasileiro (e com ponto decimal)', () => {
    assert.equal(parseMoney('12'), 1200);
    assert.equal(parseMoney('12,5'), 1250);
    assert.equal(parseMoney('R$ 1.234,56'), 123456);
    assert.equal(parseMoney('1.234'), 123400);
    assert.equal(parseMoney('12.50'), 1250);
    assert.equal(parseMoney('0,001'), undefined);
    assert.equal(parseMoney('abc'), undefined);
    assert.equal(parseMoney('0'), undefined);
    assert.equal(parseMoney(''), undefined);
    assert.equal(parseMoney('2000000'), undefined, 'passa do teto');
  });
  it('mostra os valores em reais', () => {
    assert.equal(formatCents(123456).replace(/\s/g, ' '), 'R$ 1.234,56');
    assert.equal(centsToInput(1250), '12,50');
    assert.equal(centsToInput(null), '');
  });
  it('confere o anexo', () => {
    assert.deepEqual(expenseFileCheck({ name: 'nota.jpg', type: 'image/jpeg', size: 9_000_000 }), { kind: 'IMAGE', type: 'image/jpeg' });
    assert.deepEqual(expenseFileCheck({ name: 'nota.pdf', type: '', size: 10 }), { kind: 'DOCUMENT', type: 'application/pdf' });
    assert.ok('problem' in expenseFileCheck({ name: 'nota.pdf', type: 'application/pdf', size: 11 * 1024 * 1024 }));
    assert.ok('problem' in expenseFileCheck({ name: 'x.exe', type: 'application/octet-stream', size: 10 }));
  });
  it('resume a lista e o saldo', () => {
    const item = (bought: boolean) => ({ id: 'i', title: 'x', quantity: null, createdBy: null, boughtBy: null, boughtAt: bought ? '2026-01-01T00:00:00Z' : null, canEdit: false });
    assert.equal(shoppingSummary({ items: [] }), 'Nenhum item ainda');
    assert.equal(shoppingSummary({ items: [item(false)] }), '1 item');
    assert.equal(shoppingSummary({ items: [item(true), item(false)] }), '2 itens · 1 comprado');
    assert.equal(balanceLabel(1000, true).replace(/\s/g, ' '), 'Você recebe R$ 10,00');
    assert.equal(balanceLabel(-500, false).replace(/\s/g, ' '), 'Deve R$ 5,00');
    assert.equal(balanceLabel(0, true), 'Você está quite');
  });
});
