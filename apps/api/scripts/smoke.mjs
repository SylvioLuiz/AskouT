// Teste de fumaça por HTTP: precisa da API rodando, com a saída gravada num arquivo de log
// (o código de cadastro é lido de lá, pois o envio de e-mail em desenvolvimento só imprime no log).
//
//   npx tsx ... src/http/main.ts > "$HOME/askout-api.log" 2>&1 &
//   node scripts/smoke.mjs
//
// Variáveis: ASKOUT_API_URL (padrão http://localhost:3000) e ASKOUT_API_LOG (padrão ~/askout-api.log).
// Cria usuários novos a cada execução (nomes com sufixo aleatório) e não apaga nada.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.ASKOUT_API_URL ?? 'http://localhost:3000';
const LOG = process.env.ASKOUT_API_LOG ?? join(homedir(), 'askout-api.log');
const PASSWORD = 'Senha-forte-123';

let passed = 0;
let failed = 0;

function check(name, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FALHOU ${name}${extra === undefined ? '' : ` -> ${JSON.stringify(extra)}`}`);
  }
}

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json;
  try {
    json = await response.json();
  } catch {
    json = undefined;
  }
  return { status: response.status, body: json, headers: response.headers };
}

async function codeFor(email) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const text = readFileSync(LOG, 'utf8');
    const matches = [...text.matchAll(new RegExp(`código de cadastro para ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (\\d{6})`, 'g'))];
    const last = matches.at(-1);
    if (last) return last[1];
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Código de ${email} não apareceu em ${LOG}`);
}

async function signUp(label, suffix) {
  const email = `smoke-${suffix}-${label}@exemplo.com`;
  const username = `smk${suffix}${label}`;
  const started = await call('POST', '/auth/signup', {
    body: { email, username, displayName: `Smoke ${label}`, password: PASSWORD },
  });
  if (started.status !== 200) throw new Error(`signup ${label}: ${started.status} ${JSON.stringify(started.body)}`);
  const code = await codeFor(email);
  const confirmed = await call('POST', '/auth/signup/confirm', { body: { email, code } });
  if (confirmed.status !== 201) throw new Error(`confirm ${label}: ${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  return { email, username, id: confirmed.body.user.id, token: confirmed.body.token, confirmed };
}

const suffix = Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, 'x');
console.log(`API: ${BASE}  |  log: ${LOG}  |  sufixo: ${suffix}\n`);

try {
  console.log('Cadastro e sessão');
  const a = await signUp('a', suffix);
  const b = await signUp('b', suffix);
  const c = await signUp('c', suffix);
  check('cadastro devolve usuário e token', Boolean(a.id && a.token));
  check('e-mail não aparece no perfil público', a.confirmed.body.user.profile.email === undefined);

  const me = await call('GET', '/auth/me', { token: a.token });
  check('/auth/me com token válido', me.status === 200 && me.body.id === a.id, me.body);
  check('/auth/me sem token dá 401', (await call('GET', '/auth/me')).status === 401);
  check('/auth/me com token lixo dá 401', (await call('GET', '/auth/me', { token: 'abc.def.ghi' })).status === 401);

  const login = await call('POST', '/auth/login', { body: { identifier: `@${a.username}`, password: PASSWORD } });
  check('login por @usuario', login.status === 200 && Boolean(login.body.token), login.body);
  const loginEmail = await call('POST', '/auth/login', { body: { identifier: a.email.toUpperCase(), password: PASSWORD } });
  check('login por e-mail (maiúsculas)', loginEmail.status === 200, loginEmail.body);
  const badLogin = await call('POST', '/auth/login', { body: { identifier: a.username, password: 'errada-errada' } });
  check('senha errada dá 401 genérico', badLogin.status === 401 && badLogin.body.error.code === 'UNAUTHORIZED', badLogin.body);
  const dup = await call('POST', '/auth/signup', {
    body: { email: a.email, username: `outro${suffix}`, displayName: 'X', password: PASSWORD },
  });
  check('e-mail já em uso é recusado já no cadastro (409)', dup.status === 409, dup.body);
  const wrongCode = await call('POST', '/auth/signup/confirm', { body: { email: a.email, code: '000000' } });
  check('confirmar sem cadastro pendente dá erro de código', wrongCode.status === 400, wrongCode.body);
  const junk = await call('POST', '/auth/signup', { body: 'texto solto' });
  check('corpo que não é objeto dá 400, não 500', junk.status === 400, junk.body);

  console.log('\nPerfis');
  const profile = await call('GET', `/profiles/${b.username}`, { token: a.token });
  check('ver perfil público de outra pessoa', profile.status === 200 && profile.body.canViewContent === true, profile.body);
  const search = await call('GET', `/profiles/search?q=smk${suffix}`, { token: a.token });
  check('busca encontra os outros, sem o próprio', search.status === 200 && search.body.length === 2, search.body);
  const edit = await call('PATCH', '/profiles/me', { token: a.token, body: { bio: 'Olá, AskouT' } });
  check('editar biografia', edit.status === 200 && edit.body.bio === 'Olá, AskouT', edit.body);
  const missing = await call('GET', '/profiles/naoexiste999', { token: a.token });
  check('perfil inexistente dá 404', missing.status === 404, missing.body);

  console.log('\nSeguir e amizade');
  const aFollowsB = await call('POST', `/users/${b.id}/follow`, { token: a.token });
  check('seguir perfil público vira ACCEPTED', aFollowsB.body?.status === 'ACCEPTED' && aFollowsB.body.isFriend === false, aFollowsB.body);
  const bFollowsA = await call('POST', `/users/${a.id}/follow`, { token: b.token });
  check('seguimento mútuo vira amizade', bFollowsA.body?.isFriend === true, bFollowsA.body);
  const friendsA = await call('GET', '/me/friends', { token: a.token });
  const friendsB = await call('GET', '/me/friends', { token: b.token });
  check('amigos aparecem nos dois lados', friendsA.body?.length === 1 && friendsB.body?.length === 1, [friendsA.body, friendsB.body]);
  check('seguir a si mesmo é recusado', (await call('POST', `/users/${a.id}/follow`, { token: a.token })).status === 400);
  check('id que não é UUID dá 400', (await call('POST', '/users/123/follow', { token: a.token })).status === 400);
  const followers = await call('GET', `/users/${b.id}/followers?limit=10`, { token: a.token });
  check('lista de seguidores', followers.status === 200 && followers.body.total === 1, followers.body);

  console.log('\nPerfil privado');
  const priv = await call('PATCH', '/profiles/me/privacy', { token: b.token, body: { isPrivate: true } });
  check('tornar perfil privado', priv.status === 200 && priv.body.isPrivate === true, priv.body);
  const cFollowsB = await call('POST', `/users/${b.id}/follow`, { token: c.token });
  check('seguir perfil privado fica PENDING', cFollowsB.body?.status === 'PENDING', cFollowsB.body);
  const cSees = await call('GET', `/profiles/${b.username}`, { token: c.token });
  check('pendente não vê o conteúdo', cSees.body?.canViewContent === false, cSees.body);
  const requests = await call('GET', '/me/follow-requests', { token: b.token });
  check('dono vê a solicitação', requests.body?.items?.length === 1 && requests.body.items[0].username === c.username, requests.body);
  check('quem pediu não aprova a si mesmo', (await call('POST', `/me/follow-requests/${b.id}/approve`, { token: c.token })).status === 404);
  const approved = await call('POST', `/me/follow-requests/${c.id}/approve`, { token: b.token });
  check('aprovar solicitação', approved.status === 200, approved.body);
  const cSees2 = await call('GET', `/profiles/${b.username}`, { token: c.token });
  check('depois de aprovado vê o conteúdo', cSees2.body?.canViewContent === true, cSees2.body);

  console.log('\nAgenda e compatibilidade');
  const day = (n, h) => new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + n, h)).toISOString();
  const slotA = await call('POST', '/me/availability', { token: a.token, body: { start: day(3, 22), end: day(4, 2), state: 'AVAILABLE' } });
  check('criar horário', slotA.status < 300 && slotA.body?.id, slotA.body);
  const overlap = await call('POST', '/me/availability', { token: a.token, body: { start: day(3, 23), end: day(4, 1), state: 'UNAVAILABLE' } });
  check('horário sobreposto é recusado (409)', overlap.status === 409, overlap.body);
  const badSlot = await call('POST', '/me/availability', { token: a.token, body: { start: 'amanhã', end: day(4, 2), state: 'TALVEZ' } });
  check('horário inválido dá 400 com campos', badSlot.status === 400 && badSlot.body?.error?.details?.state, badSlot.body);
  const mine = await call('GET', `/me/availability?from=${encodeURIComponent(day(0, 0))}&to=${encodeURIComponent(day(10, 0))}`, { token: a.token });
  check('listar meus horários', mine.status === 200 && mine.body.length === 1, mine.body);
  const friendRange = `from=${encodeURIComponent(day(0, 0))}&to=${encodeURIComponent(day(10, 0))}`;
  check('amigo vê a agenda', (await call('GET', `/users/${a.id}/availability?${friendRange}`, { token: b.token })).status === 200);
  check('quem não é amigo não vê (403)', (await call('GET', `/users/${a.id}/availability?${friendRange}`, { token: c.token })).status === 403);
  const compat = await call('POST', '/compatibility', { token: a.token, body: { friendIds: [b.id], start: day(3, 23), end: day(4, 1) } });
  check('compatibilidade sem info do amigo = aguardando', compat.status === 200 && compat.body.level === 'awaiting', compat.body);
  await call('POST', '/me/availability', { token: b.token, body: { start: day(3, 22), end: day(4, 2), state: 'AVAILABLE' } });
  const compat2 = await call('POST', '/compatibility', { token: a.token, body: { friendIds: [b.id], start: day(3, 23), end: day(4, 1) } });
  check('os dois livres = verde', compat2.body?.level === 'green', compat2.body);
  const best = await call('POST', '/compatibility/best-dates', { token: a.token, body: { friendIds: [b.id], fromDate: day(1, 0).slice(0, 10), toDate: day(6, 0).slice(0, 10), durationMinutes: 120, earliestStart: '16:00', latestStart: '23:00', limit: 3 } });
  check('melhor data devolve candidatos verdes primeiro', best.status === 200 && best.body.items?.[0]?.level === 'green', best.body);
  check('compatibilidade com quem não é amigo (403)', (await call('POST', '/compatibility', { token: a.token, body: { friendIds: [c.id], start: day(3, 23), end: day(4, 1) } })).status === 403);
  check('remover horário', (await call('DELETE', `/me/availability/${slotA.body.id}`, { token: a.token })).body?.removed === true);

  console.log('\nBloqueio');
  const block = await call('POST', `/users/${b.id}/block`, { token: a.token });
  check('bloquear', block.status === 200, block.body);
  const friendsAfter = await call('GET', '/me/friends', { token: a.token });
  check('bloqueio encerra a amizade', friendsAfter.body?.length === 0, friendsAfter.body);
  const blockedView = await call('GET', `/profiles/${a.username}`, { token: b.token });
  check('quem foi bloqueado não encontra o perfil (404)', blockedView.status === 404, blockedView.body);
  const blockedFollow = await call('POST', `/users/${a.id}/follow`, { token: b.token });
  check('quem foi bloqueado não consegue seguir', blockedFollow.status === 404 || blockedFollow.status === 403, blockedFollow.body);
  const blockedList = await call('GET', '/me/blocks', { token: a.token });
  check('lista de bloqueados', blockedList.body?.length === 1, blockedList.body);
  const unblock = await call('DELETE', `/users/${b.id}/block`, { token: a.token });
  check('desbloquear', unblock.status === 200 && unblock.body.removed === true, unblock.body);
} catch (error) {
  failed += 1;
  console.log(`\nERRO NO TESTE: ${error instanceof Error ? error.message : error}`);
}

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
