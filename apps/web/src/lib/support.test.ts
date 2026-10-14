import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { initials, tintIndex, TINT_COUNT } from './avatar.ts';
import { fieldsFrom, toApiError, ApiError } from './errors.ts';
import { formatCountdown, formatCount, pluralize, secondsUntil } from './format.ts';
import { hasIncomingRequest, profileAction, relationNote } from './relations.ts';
import { matchPath } from './route-match.ts';
import { createSessionStore } from './session.ts';
import type { StorageLike } from './session.ts';
import type { Relationship } from './types.ts';
import {
  avatarUrlProblem,
  bioProblem,
  codeProblem,
  compact,
  displayNameProblem,
  emailProblem,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
} from './validation.ts';

const rel = (patch: Partial<Relationship> = {}): Relationship => ({
  isSelf: false,
  following: 'NONE',
  followsYou: 'NONE',
  isFriend: false,
  blockedByViewer: false,
  ...patch,
});

describe('sessão', () => {
  function memoryStorage(): StorageLike & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  }

  it('guarda, lê e limpa o token', () => {
    const store = createSessionStore(memoryStorage());
    assert.equal(store.get(), undefined);
    store.set('abc');
    assert.equal(store.get(), 'abc');
    store.clear();
    assert.equal(store.get(), undefined);
  });

  it('sobrevive a armazenamento que lança erro, usando a memória', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    };
    const store = createSessionStore(broken);
    store.set('abc');
    assert.equal(store.get(), 'abc');
    store.clear();
    assert.equal(store.get(), undefined);
  });

  it('funciona sem armazenamento algum', () => {
    const store = createSessionStore(undefined);
    store.set('x');
    assert.equal(store.get(), 'x');
  });

  it('clear remove do armazenamento mesmo se a memória já foi limpa', () => {
    const storage = memoryStorage();
    storage.data.set('askout.token', 'antigo');
    const store = createSessionStore(storage);
    assert.equal(store.get(), 'antigo');
    store.clear();
    assert.equal(storage.data.size, 0);
  });
});

describe('validação de formulário', () => {
  it('normaliza @usuario', () => {
    assert.equal(normalizeUsername('  @Ana.Maria '), 'ana.maria');
    assert.equal(normalizeUsername('@@x'), 'x');
  });

  it('e-mail', () => {
    assert.equal(emailProblem('ana@exemplo.com'), undefined);
    for (const bad of ['', 'ana', 'ana@', 'ana@x', 'a b@x.co']) assert.ok(emailProblem(bad), bad);
  });

  it('usuário', () => {
    assert.equal(usernameProblem('ana.maria_1'), undefined);
    for (const bad of ['ab', 'a'.repeat(31), 'Ana', 'an a', '.ana', 'ana.', 'a..b', 'ana-1']) {
      assert.ok(usernameProblem(bad), bad);
    }
  });

  it('senha, nome, bio, foto e código', () => {
    assert.ok(passwordProblem('1234567'));
    assert.equal(passwordProblem('12345678'), undefined);
    assert.ok(passwordProblem('a'.repeat(129)));
    assert.ok(displayNameProblem('', true));
    assert.equal(displayNameProblem('', false), undefined);
    assert.ok(displayNameProblem('x'.repeat(51), true));
    assert.equal(displayNameProblem('x'.repeat(50), true), undefined);
    assert.ok(bioProblem('x'.repeat(151)));
    assert.equal(bioProblem('x'.repeat(150)), undefined);
    assert.equal(avatarUrlProblem(''), undefined);
    assert.equal(avatarUrlProblem('https://exemplo.com/a.png'), undefined);
    assert.ok(avatarUrlProblem('http://exemplo.com/a.png'));
    assert.ok(avatarUrlProblem('javascript:alert(1)'));
    assert.ok(avatarUrlProblem('nada'));
    assert.equal(codeProblem('012345'), undefined);
    for (const bad of ['12345', '1234567', 'abcdef', '']) assert.ok(codeProblem(bad), bad);
  });

  it('compact remove campos sem erro', () => {
    assert.deepEqual(compact({ a: 'x', b: undefined }), { a: 'x' });
  });
});

describe('avatar', () => {
  it('iniciais', () => {
    assert.equal(initials('bruna.alves'), 'BA');
    assert.equal(initials('ana_maria_souza'), 'AM');
    assert.equal(initials('bruno'), 'BR');
    assert.equal(initials('a'), 'A');
    assert.equal(initials('édson.lima'), 'ÉL');
    assert.equal(initials('...'), '?');
  });

  it('cor estável e dentro do intervalo', () => {
    assert.equal(tintIndex('ana'), tintIndex('ana'));
    for (const name of ['a', 'ana', 'bruno.silva', 'x'.repeat(40)]) {
      const index = tintIndex(name);
      assert.ok(index >= 0 && index < TINT_COUNT);
    }
  });
});

describe('relações', () => {
  it('botão principal do perfil', () => {
    assert.deepEqual(profileAction(rel({ isSelf: true })), { kind: 'self' });
    assert.deepEqual(profileAction(rel({ blockedByViewer: true, following: 'ACCEPTED' })), { kind: 'blocked' });
    assert.deepEqual(profileAction(rel()), { kind: 'follow', label: 'Seguir' });
    assert.deepEqual(profileAction(rel({ followsYou: 'ACCEPTED' })), { kind: 'follow', label: 'Seguir de volta' });
    assert.deepEqual(profileAction(rel({ following: 'PENDING' })), { kind: 'requested', label: 'Solicitado' });
    assert.deepEqual(profileAction(rel({ following: 'ACCEPTED', isFriend: true })), { kind: 'following', label: 'Seguindo' });
  });

  it('frase da relação e pedido recebido', () => {
    assert.equal(relationNote(rel({ isFriend: true, following: 'ACCEPTED', followsYou: 'ACCEPTED' })), 'Vocês são amigos');
    assert.equal(relationNote(rel({ followsYou: 'ACCEPTED' })), 'Segue você');
    assert.equal(relationNote(rel()), undefined);
    assert.equal(relationNote(rel({ isSelf: true })), undefined);
    assert.equal(relationNote(rel({ blockedByViewer: true, followsYou: 'ACCEPTED' })), undefined);
    assert.equal(hasIncomingRequest(rel({ followsYou: 'PENDING' })), true);
    assert.equal(hasIncomingRequest(rel({ followsYou: 'ACCEPTED' })), false);
    assert.equal(hasIncomingRequest(rel({ followsYou: 'PENDING', blockedByViewer: true })), false);
  });
});

describe('formatação', () => {
  it('contagens e plural', () => {
    assert.equal(formatCount(950), '950');
    assert.equal(formatCount(0), '0');
    assert.equal(pluralize(1, 'seguidor', 'seguidores'), '1 seguidor');
    assert.equal(pluralize(0, 'seguidor', 'seguidores'), '0 seguidores');
    assert.equal(pluralize(12, 'seguidor', 'seguidores'), '12 seguidores');
  });

  it('contagem regressiva', () => {
    assert.equal(formatCountdown(75), '1:15');
    assert.equal(formatCountdown(9), '0:09');
    assert.equal(formatCountdown(-5), '0:00');
    assert.equal(secondsUntil('2026-10-13T12:01:00Z', Date.parse('2026-10-13T12:00:00Z')), 60);
    assert.equal(secondsUntil('2026-10-13T12:00:00Z', Date.parse('2026-10-13T12:05:00Z')), 0);
    assert.equal(secondsUntil('lixo', 0), 0);
  });
});

describe('rotas e erros', () => {
  it('casa padrões e decodifica parâmetros', () => {
    assert.deepEqual(matchPath('/', '/'), {});
    assert.deepEqual(matchPath('/u/:username', '/u/ana'), { username: 'ana' });
    assert.deepEqual(matchPath('/u/:username/seguidores', '/u/ana.maria/seguidores/'), { username: 'ana.maria' });
    assert.deepEqual(matchPath('/u/:username', '/u/a%20b'), { username: 'a b' });
    assert.equal(matchPath('/u/:username', '/u'), undefined);
    assert.equal(matchPath('/u/:username', '/x/ana'), undefined);
    assert.equal(matchPath('/u/:username', '/u/ana/extra'), undefined);
    assert.equal(matchPath('/u/:username', '/u/%E0%A4%A'), undefined);
  });

  it('fieldsFrom e toApiError', () => {
    assert.deepEqual(fieldsFrom({ a: 'x', b: 1, c: null }), { a: 'x' });
    assert.deepEqual(fieldsFrom(['x']), {});
    assert.deepEqual(fieldsFrom(undefined), {});
    const known = new ApiError('NOT_FOUND', 'x');
    assert.equal(toApiError(known), known);
    assert.equal(toApiError(new Error('boom')).code, 'INTERNAL');
    assert.ok(!toApiError(new Error('boom')).message.includes('boom'));
  });
});
