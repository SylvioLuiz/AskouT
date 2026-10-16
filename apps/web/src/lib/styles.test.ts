import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function block(start: string): string {
  const i = css.indexOf(start);
  assert.ok(i >= 0, `bloco não encontrado: ${start}`);
  return css.slice(i, css.indexOf('\n}', i));
}
function tokens(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of source.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const light = tokens(block(':root {'));
const dark = { ...light, ...tokens(block(":root[data-theme='dark'] {")) };

describe('contraste dos tokens', () => {
  for (const [name, t] of [['claro', light], ['escuro', dark]] as const) {
    it(`${name}: texto principal e secundário passam de 4,5:1`, () => {
      assert.ok(ratio(t['ink']!, t['bg']!) >= 4.5);
      assert.ok(ratio(t['muted']!, t['bg']!) >= 4.5);
      assert.ok(ratio(t['muted']!, t['surface']!) >= 4.5);
    });
    it(`${name}: cor da marca como texto passa de 4,5:1`, () => {
      assert.ok(ratio(t['brand']!, t['bg']!) >= 4.5, `${t['brand']} sobre ${t['bg']}`);
    });
    it(`${name}: bordas de controles passam de 3:1 sobre o cartão`, () => {
      assert.ok(ratio(t['control-border']!, t['surface']!) >= 3, `${t['control-border']} sobre ${t['surface']}`);
    });
    it(`${name}: cores do semáforo passam de 3:1 sobre o cartão`, () => {
      for (const k of ['ok', 'warn', 'bad', 'wait']) assert.ok(ratio(t[k]!, t['surface']!) >= 3, `${k} ${t[k]} sobre ${t['surface']}`);
    });
    it(`${name}: texto de confirmação verde passa de 4,5:1`, () => {
      assert.ok(ratio(t['ok-ink']!, t['surface']!) >= 4.5, `${t['ok-ink']}`);
    });
  }
});

describe('cores fora dos tokens', () => {
  it('não cresce a quantidade de cores fixas no CSS', () => {
    const count = (css.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length;
    // Teto atual. Cor nova entra como token (--nome) nos blocos :root; baixe este número quando limpar cores antigas.
    assert.ok(count <= 260, `há ${count} cores fixas; use um token em vez de uma cor nova`);
  });
});
