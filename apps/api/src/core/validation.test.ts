import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avatarUrlProblem,
  bioProblem,
  displayNameProblem,
  emailProblem,
  normalizeBio,
  normalizeDisplayName,
  normalizeEmail,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
} from './validation.ts';

test('e-mail: normaliza e valida', () => {
  assert.equal(normalizeEmail('  Ana@Exemplo.COM '), 'ana@exemplo.com');
  assert.equal(emailProblem('ana@exemplo.com'), undefined);
  assert.ok(emailProblem('ana@exemplo'));
  assert.ok(emailProblem('ana exemplo@x.com'));
  assert.ok(emailProblem(`${'a'.repeat(250)}@x.com`));
});

test('username: normaliza (minúsculas, sem @) e aplica regras', () => {
  assert.equal(normalizeUsername(' @Ana.Silva '), 'ana.silva');
  assert.equal(usernameProblem('ana.silva_01'), undefined);
  assert.ok(usernameProblem('ab'), 'curto demais');
  assert.ok(usernameProblem('a'.repeat(31)), 'longo demais');
  assert.ok(usernameProblem('ana silva'), 'espaço');
  assert.ok(usernameProblem('ana-silva'), 'hífen não permitido');
  assert.ok(usernameProblem('.ana'), 'começa com ponto');
  assert.ok(usernameProblem('ana.'), 'termina com ponto');
  assert.ok(usernameProblem('ana..silva'), 'pontos seguidos');
  assert.ok(usernameProblem('admin'), 'reservado');
  assert.ok(usernameProblem('askout'), 'reservado');
});

test('senha: tamanho, comuns e igualdade com e-mail/username', () => {
  const ok = (p: string) => passwordProblem(p, 'ana@exemplo.com', 'ana');
  assert.equal(ok('uma-senha-forte-123'), undefined);
  assert.ok(ok('curta1'));
  assert.ok(ok('x'.repeat(129)));
  assert.ok(ok('        '), 'só espaços');
  assert.ok(ok('12345678'), 'comum');
  assert.ok(ok('PASSWORD'), 'comum, sem diferenciar maiúsculas');
  assert.ok(passwordProblem('ana@exemplo.com', 'ana@exemplo.com', 'ana'), 'igual ao e-mail');
  assert.ok(passwordProblem('analuiza1', 'x@y.com', 'analuiza1'), 'igual ao username');
});

test('nome de exibição: espaços colapsados, tamanho e caracteres de controle', () => {
  assert.equal(normalizeDisplayName('  Ana   Silva '), 'Ana Silva');
  assert.equal(displayNameProblem('Ana Silva'), undefined);
  assert.ok(displayNameProblem(''));
  assert.ok(displayNameProblem('a'.repeat(51)));
  assert.ok(displayNameProblem('Ana\u0000'));
});

test('biografia: vazio vira null, limite, quebra de linha permitida', () => {
  assert.equal(normalizeBio('   '), null);
  assert.equal(normalizeBio(null), null);
  assert.equal(normalizeBio(' oi '), 'oi');
  assert.equal(bioProblem(null), undefined);
  assert.equal(bioProblem('linha 1\nlinha 2'), undefined);
  assert.ok(bioProblem('a'.repeat(151)));
  assert.ok(bioProblem('oi\u0000'));
});

test('foto: só https e URL válida', () => {
  assert.equal(avatarUrlProblem(null), undefined);
  assert.equal(avatarUrlProblem('https://cdn.exemplo.com/a.png'), undefined);
  assert.ok(avatarUrlProblem('http://cdn.exemplo.com/a.png'));
  assert.ok(avatarUrlProblem('javascript:alert(1)'));
  assert.ok(avatarUrlProblem('não é url'));
  assert.ok(avatarUrlProblem(`https://x.com/${'a'.repeat(2100)}`));
});
