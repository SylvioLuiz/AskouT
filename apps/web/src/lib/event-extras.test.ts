import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extrasDraftFrom, extrasFromDraft, toggleYesNo } from './event-extras.ts';
import type { EventExtraOption } from './types.ts';

const options: EventExtraOption[] = [
  { id: 'fumar', icon: 'smoking', label: 'Pode fumar?', type: 'YES_NO' },
  { id: 'estac', icon: 'car', label: 'Estacionamento', type: 'TEXT' },
  { id: 'pet', icon: 'pet', label: 'Aceita pets?', type: 'YES_NO' },
];

test('o rascunho vira respostas na ordem da gestão, sem texto vazio nem configuração apagada', () => {
  const draft = { estac: '  na rua de trás ', fumar: false, pet: '', sumiu: true };
  assert.deepEqual(extrasFromDraft(draft, options), [{ optionId: 'fumar', value: false }, { optionId: 'estac', value: 'na rua de trás' }]);
  assert.deepEqual(extrasFromDraft({}, options), []);
});

test('sim/não: tocar de novo na mesma resposta desmarca', () => {
  let draft = extrasDraftFrom([{ optionId: 'fumar', value: true }]);
  draft = toggleYesNo(draft, 'fumar', false);
  assert.deepEqual(draft, { fumar: false });
  draft = toggleYesNo(draft, 'fumar', false);
  assert.deepEqual(draft, {});
});
