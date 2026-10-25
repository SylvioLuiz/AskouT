import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { pickLocale, setLocaleForTests, t } from './index.ts';

describe('i18n', () => {
  afterEach(() => setLocaleForTests('pt-BR'));
  it('escolhe o idioma pelo código do aparelho', () => {
    assert.equal(pickLocale('en-US'), 'en');
    assert.equal(pickLocale('es-MX'), 'es');
    assert.equal(pickLocale('pt-PT'), 'pt-BR');
    assert.equal(pickLocale('fr-FR'), 'pt-BR');
    assert.equal(pickLocale(undefined), 'pt-BR');
  });
  it('sem tradução, mostra o português e preenche variáveis', () => {
    setLocaleForTests('en');
    assert.equal(t('Texto sem tradução {n}', { n: 3 }), 'Texto sem tradução 3');
  });
});
