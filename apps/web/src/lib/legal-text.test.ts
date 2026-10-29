import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildLegal, buildPrivacy, buildTerms, LEGAL_REVIEWED, privacyEmail } from './legal-text.ts';

describe('textos legais', () => {
  it('e-mail de contato: usa o configurado se for válido, senão o padrão', () => {
    assert.equal(privacyEmail(undefined), 'privacidade@askout.com.br');
    assert.equal(privacyEmail('  lgpd@empresa.com.br '), 'lgpd@empresa.com.br');
    assert.equal(privacyEmail('isto não é e-mail'), 'privacidade@askout.com.br');
  });

  it('todo bloco tem título e conteúdo, sem textos repetidos (a tela usa o texto como chave)', () => {
    for (const doc of [buildPrivacy('a@b.co'), buildTerms('a@b.co')]) {
      const seen = new Set<string>();
      for (const b of doc.blocks) {
        assert.ok(b.title.length > 0);
        const parts = [...(b.text ?? []), ...(b.items ?? [])];
        assert.ok(parts.length > 0, b.title);
        for (const p of parts) {
          assert.ok(!seen.has(p), `repetido: ${p.slice(0, 40)}`);
          seen.add(p);
        }
      }
    }
  });

  it('a política cobre o que o app trata de verdade e os direitos da LGPD', () => {
    const text = JSON.stringify(buildPrivacy('a@b.co'));
    for (const term of ['localização', 'Resend', 'Railway', 'Cloudflare', 'Google', 'OpenStreetMap', 'Stripe', 'ANPD', '15 dias', 'portabilidade', 'a@b.co', '18 anos']) {
      assert.ok(text.includes(term), `falta: ${term}`);
    }
  });

  it('enquanto houver campo a preencher, o texto não pode se declarar revisado', () => {
    const text = JSON.stringify([buildPrivacy('a@b.co'), buildTerms('a@b.co')]);
    if (text.includes('[A preencher') || text.includes('[A definir')) assert.equal(LEGAL_REVIEWED, false);
  });

  it('en e es: mesmos blocos do português, aviso de cortesia e as cláusulas que a App Store exige', () => {
    for (const doc of ['privacy', 'terms'] as const) {
      const pt = buildLegal(doc, 'a@b.co', 'pt-BR');
      for (const locale of ['en', 'es'] as const) {
        const tr = buildLegal(doc, 'a@b.co', locale);
        assert.equal(tr.blocks.length, pt.blocks.length, `${doc} ${locale}: blocos`);
        pt.blocks.forEach((b, i) => {
          assert.equal(tr.blocks[i]!.items?.length, b.items?.length, `${doc} ${locale} bloco ${i + 1}: itens`);
          assert.equal(tr.blocks[i]!.text?.length, b.text?.length, `${doc} ${locale} bloco ${i + 1}: parágrafos`);
        });
        assert.ok(tr.notice && tr.updated, `${doc} ${locale}: aviso e data`);
        assert.ok(JSON.stringify(tr).includes('a@b.co'));
      }
    }
    const en = JSON.stringify(buildLegal('terms', 'a@b.co', 'en'));
    for (const term of ['Zero tolerance', '24 hours', 'block', 'report']) assert.ok(en.includes(term), `en: falta ${term}`);
    const es = JSON.stringify(buildLegal('terms', 'a@b.co', 'es'));
    for (const term of ['Tolerancia cero', '24 horas', 'bloquear', 'denunciar']) assert.ok(es.includes(term), `es: falta ${term}`);
  });
});
