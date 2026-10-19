import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MENTIONS_MAX, extractMentions } from './mentions.ts';

test('acha @usuario no texto, em minúsculas, sem repetir e sem pontuação do fim', () => {
  assert.deepEqual(extractMentions('Bora @Ana.Silva e @bia_1, @ana.silva!'), ['ana.silva', 'bia_1']);
  assert.deepEqual(extractMentions('@ana.'), ['ana']);
  assert.deepEqual(extractMentions('(@caio) valeu'), ['caio']);
});

test('ignora e-mail, @ solto, nome curto demais e passa de 10 só guarda 10', () => {
  assert.deepEqual(extractMentions('fale com ana@exemplo.com'), []);
  assert.deepEqual(extractMentions('oi @ ana e @ab'), []);
  assert.deepEqual(extractMentions('@@ana'), []);
  const many = Array.from({ length: 15 }, (_, i) => `@user${String(i).padStart(2, '0')}`).join(' ');
  assert.equal(extractMentions(many).length, MENTIONS_MAX);
});
