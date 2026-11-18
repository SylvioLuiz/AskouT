import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CHAT_COLORS, chatColorStyle, findChatColor } from './chat-color.ts';

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// Fundo e cartão dos temas claro e escuro (styles.css).
const LIGHT = ['#f2f2f7', '#ffffff'];
const DARK = ['#1b1c26', '#262833'];

describe('cores da conversa', () => {
  it('ids batem com a lista da API e não repetem', () => {
    assert.deepEqual(CHAT_COLORS.map((c) => c.id), ['purple', 'blue', 'teal', 'green', 'yellow', 'orange', 'red', 'graphite']);
  });
  for (const c of CHAT_COLORS) {
    it(`${c.id}: textos passam de 4,5:1`, () => {
      assert.ok(ratio(c.ink, c.fill) >= 4.5, `texto sobre o balão ${ratio(c.ink, c.fill).toFixed(2)}`);
      for (const bg of [...LIGHT, c.soft]) assert.ok(ratio(c.text, bg) >= 4.5, `claro: ${c.text} sobre ${bg} ${ratio(c.text, bg).toFixed(2)}`);
      for (const bg of [...DARK, c.softDark]) assert.ok(ratio(c.textDark, bg) >= 4.5, `escuro: ${c.textDark} sobre ${bg} ${ratio(c.textDark, bg).toFixed(2)}`);
    });
  }
  it('sem cor ou cor desconhecida: fica a cor padrão', () => {
    assert.equal(chatColorStyle(null), undefined);
    assert.equal(chatColorStyle('rosa-choque'), undefined);
    assert.equal(findChatColor('blue')?.label, 'Azul');
    assert.equal((chatColorStyle('blue') as Record<string, string>)['--cc-fill'], '#6fa8ff');
  });
});
