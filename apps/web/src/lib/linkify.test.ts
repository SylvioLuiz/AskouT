import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inAppPath, splitLinks } from './linkify.ts';

const links = (text: string) => splitLinks(text).filter((p) => p.href).map((p) => [p.text, p.href]);

test('splitLinks: http, www e domínio sem protocolo', () => {
  assert.deepEqual(links('olha https://askout.com.br/eventos/1 e www.google.com'), [
    ['https://askout.com.br/eventos/1', 'https://askout.com.br/eventos/1'],
    ['www.google.com', 'https://www.google.com'],
  ]);
  assert.deepEqual(links('segue instagram.com/whatsbar_ lá'), [['instagram.com/whatsbar_', 'https://instagram.com/whatsbar_']]);
});

test('splitLinks: pontuação do fim e parêntese da frase ficam fora', () => {
  assert.deepEqual(links('veja isso: site.com.br.'), [['site.com.br', 'https://site.com.br']]);
  assert.deepEqual(links('(link em https://a.com/x)'), [['https://a.com/x', 'https://a.com/x']]);
  assert.deepEqual(links('wiki https://pt.wikipedia.org/wiki/Santos_(SP)!'), [['https://pt.wikipedia.org/wiki/Santos_(SP)', 'https://pt.wikipedia.org/wiki/Santos_(SP)']]);
});

test('splitLinks: não vira link em e-mail, hora, número ou palavra com ponto', () => {
  assert.deepEqual(links('me manda em ana@gmail.com às 19.30'), []);
  assert.deepEqual(links('fim. Depois a gente vê'), []);
  assert.equal(splitLinks('oi').length, 1);
});

test('splitLinks: o texto volta inteiro, na ordem', () => {
  const text = 'a https://x.com b www.y.com.br c';
  assert.equal(splitLinks(text).map((p) => p.text).join(''), text);
});

test('inAppPath: só links do AskouT abrem dentro do app', () => {
  assert.equal(inAppPath('https://askout.com.br/eventos/1?x=2'), '/eventos/1?x=2');
  assert.equal(inAppPath('https://instagram.com/a'), undefined);
});
