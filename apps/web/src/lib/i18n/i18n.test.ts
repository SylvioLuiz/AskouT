import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { EN } from './en.ts';
import { ES } from './es.ts';
import { decimal, pickLocale, setLocaleForTests, t } from './index.ts';

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

describe('dicionários', () => {
  afterEach(() => setLocaleForTests('pt-BR'));
  it('traduz para inglês e espanhol com variáveis', () => {
    setLocaleForTests('en');
    assert.equal(t('Entrar'), 'Sign in');
    assert.equal(t('Olá, {name}', { name: 'Ana' }), 'Hi, Ana');
    setLocaleForTests('es');
    assert.equal(t('Entrar'), 'Entrar');
    assert.equal(t('Olá, {name}', { name: 'Ana' }), 'Hola, Ana');
  });
  it('mantém os mesmos {marcadores} do original em todas as traduções', () => {
    for (const [lang, dict] of [['en', EN], ['es', ES]] as const) {
      for (const [key, value] of Object.entries(dict)) {
        const want = (key.match(/\{\w+\}/g) ?? []).sort().join();
        const got = (value.match(/\{\w+\}/g) ?? []).sort().join();
        assert.equal(got, want, `${lang}: ${key}`);
      }
    }
  });
  it('números decimais seguem o idioma', () => {
    assert.equal(decimal('1.2'), '1,2');
    setLocaleForTests('en');
    assert.equal(decimal('1.2'), '1.2');
  });
});
