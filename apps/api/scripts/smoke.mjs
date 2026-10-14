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
  // JPEG mínimo válido (1x1) para testar a foto de perfil.
  const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  const photo = await call('PUT', '/profiles/me/photo', { token: a.token, body: { image: tinyJpeg } });
  check('subir foto de perfil', photo.status === 200 && typeof photo.body.avatarUrl === 'string' && photo.body.avatarUrl.startsWith('/users/'), photo.body);
  const avatar = await fetch(`${BASE}${photo.body?.avatarUrl ?? '/users/x/avatar'}`);
  check('foto é servida como imagem, sem login', avatar.status === 200 && /image\/jpeg/.test(avatar.headers.get('content-type') ?? ''), avatar.status);
  check('foto que não é imagem: 400', (await call('PUT', '/profiles/me/photo', { token: a.token, body: { image: 'data:text/html;base64,PGI+' } })).status === 400);
  check('remover foto', (await call('PUT', '/profiles/me/photo', { token: a.token, body: { image: null } })).body?.avatarUrl === null);
  check('eventos postados: lista vazia no começo', (await call('GET', `/profiles/${a.username}/events`, { token: a.token })).body?.total === 0);
  check('meus encontros: lista', Array.isArray((await call('GET', '/meetups', { token: a.token })).body?.items));
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

  console.log('\nFlash');
  check('Flash começa desligado', (await call('GET', '/me/flash', { token: a.token })).body?.active === false);
  check('lista de disponíveis exige Flash ligado (403)', (await call('GET', '/flash/available', { token: a.token })).status === 403);
  check('duração inválida dá 400', (await call('POST', '/me/flash', { token: a.token, body: { hours: 5 } })).status === 400);
  const flashA = await call('POST', '/me/flash', { token: a.token, body: { hours: 2, note: 'Bora um café' } });
  check('ligar Flash por 2 h', flashA.status === 200 && flashA.body?.active === true && flashA.body.note === 'Bora um café', flashA.body);
  check('ligar de novo sem desligar dá 409', (await call('POST', '/me/flash', { token: a.token, body: { hours: 1 } })).status === 409);
  const solo = await call('GET', '/flash/available', { token: a.token });
  check('sozinho: lista de disponíveis vazia', solo.status === 200 && solo.body.items.length === 0, solo.body);
  await call('POST', '/me/flash', { token: b.token, body: { hours: 1 } });
  await call('POST', '/me/flash', { token: c.token, body: { hours: 1 } });
  const avail = await call('GET', '/flash/available', { token: a.token });
  check('amigo com Flash aparece (só nome e foto, sem localização)', avail.body?.items?.length === 1 && avail.body.items[0].profile.userId === b.id && !JSON.stringify(avail.body).includes('"lat"'), avail.body);
  check('quem não é amigo não aparece nem pode ser convidado (403)', (await call('POST', '/flash/invites', { token: a.token, body: { userId: c.id } })).status === 403);
  check('convidar a si mesmo dá 400', (await call('POST', '/flash/invites', { token: a.token, body: { userId: a.id } })).status === 400);
  const hide1 = await call('PUT', `/flash/visibility/${b.id}`, { token: a.token, body: { hideTheirs: true } });
  check('ocultar o Flash dele (grava na tabela FlashHidden)', hide1.status === 200 && hide1.body?.hideTheirs === true && hide1.body.hideMine === false, hide1.body);
  check('oculto: some da minha lista de disponíveis', (await call('GET', '/flash/available', { token: a.token })).body?.items?.length === 0);
  check('oculto: não dá para convidar (409)', (await call('POST', '/flash/invites', { token: a.token, body: { userId: b.id } })).status === 409);
  const hide2 = await call('PUT', `/flash/visibility/${b.id}`, { token: a.token, body: { hideTheirs: false, hideMine: true } });
  check('não deixar ele me ver: ele não me vê, eu continuo vendo', hide2.body?.hideMine === true && (await call('GET', '/flash/available', { token: b.token })).body?.items?.length === 0 && (await call('GET', '/flash/available', { token: a.token })).body?.items?.length === 1);
  check('a escolha é só minha: ele não vê meu estado', (await call('GET', `/flash/visibility/${a.id}`, { token: b.token })).body?.hideMine === false);
  check('visibilidade com valor inválido dá 400', (await call('PUT', `/flash/visibility/${b.id}`, { token: a.token, body: { hideMine: 'sim' } })).status === 400);
  await call('PUT', `/flash/visibility/${b.id}`, { token: a.token, body: { hideTheirs: false, hideMine: false } });
  const inv = await call('POST', '/flash/invites', { token: a.token, body: { userId: b.id } });
  check('convidar amigo', inv.status < 300 && inv.body?.id && inv.body.direction === 'SENT', inv.body);
  check('convite duplicado dá 409', (await call('POST', '/flash/invites', { token: a.token, body: { userId: b.id } })).status === 409);
  const boxB = await call('GET', '/flash/invites', { token: b.token });
  check('o convidado vê o convite recebido', boxB.body?.received?.length === 1 && boxB.body.received[0].id === inv.body.id, boxB.body);
  check('antes de aceitar não há encontro nem posição (404)', (await call('GET', `/flash/matches/${inv.body.id}`, { token: a.token })).status === 404);
  check('antes de aceitar não dá para enviar posição (404)', (await call('PUT', `/flash/matches/${inv.body.id}/location`, { token: a.token, body: { lat: -23.55, lng: -46.63 } })).status === 404);
  check('quem convidou não aceita o próprio convite (404)', (await call('POST', `/flash/invites/${inv.body.id}/respond`, { token: a.token, body: { action: 'accept' } })).status === 404);
  check('ação inválida dá 400', (await call('POST', `/flash/invites/${inv.body.id}/respond`, { token: b.token, body: { action: 'talvez' } })).status === 400);
  const accepted = await call('POST', `/flash/invites/${inv.body.id}/respond`, { token: b.token, body: { action: 'accept' } });
  check('aceitar o convite', accepted.status === 200 && accepted.body?.status === 'ACCEPTED', accepted.body);
  check('coordenada inválida dá 400', (await call('PUT', `/flash/matches/${inv.body.id}/location`, { token: a.token, body: { lat: 123, lng: 0 } })).status === 400);
  check('enviar posição (A)', (await call('PUT', `/flash/matches/${inv.body.id}/location`, { token: a.token, body: { lat: -23.5505, lng: -46.6333, accuracyM: 12 } })).status === 200);
  const m1 = await call('GET', `/flash/matches/${inv.body.id}`, { token: b.token });
  check('B ainda não enviou: vê a posição de A e a sua é nula', m1.status === 200 && m1.body.them?.lat === -23.5505 && m1.body.me === null && m1.body.them.stale === false, m1.body);
  await call('PUT', `/flash/matches/${inv.body.id}/location`, { token: b.token, body: { lat: -23.56, lng: -46.64 } });
  const m2 = await call('GET', `/flash/matches/${inv.body.id}`, { token: a.token });
  check('depois de aceito, cada um vê a posição do outro', m2.body?.them?.lat === -23.56 && m2.body.me?.lat === -23.5505, m2.body);
  check('terceiro não vê o encontro (404)', (await call('GET', `/flash/matches/${inv.body.id}`, { token: c.token })).status === 404);
  const overview = await call('GET', '/flash/invites', { token: a.token });
  check('o encontro aparece em "matches"', overview.body?.matches?.length === 1 && overview.body.received.length === 0, overview.body);
  const endedMatch = await call('DELETE', `/flash/invites/${inv.body.id}`, { token: b.token });
  check('encerrar o encontro', endedMatch.status === 200 && endedMatch.body?.ended === true, endedMatch.body);
  check('depois de encerrado a posição some (404)', (await call('GET', `/flash/matches/${inv.body.id}`, { token: a.token })).status === 404);

  const inv2 = await call('POST', '/flash/invites', { token: a.token, body: { userId: b.id } });
  check('novo convite depois de encerrar', inv2.status < 300, inv2.body);
  const declined = await call('POST', `/flash/invites/${inv2.body.id}/respond`, { token: b.token, body: { action: 'decline' } });
  check('recusar o convite', declined.body?.status === 'DECLINED', declined.body);

  const inv3 = await call('POST', '/flash/invites', { token: a.token, body: { userId: b.id } });
  check('convite para testar o desligar', inv3.status < 300, inv3.body);
  check('desligar o Flash', (await call('DELETE', '/me/flash', { token: a.token })).body?.ended === true);
  check('desligar cancela convites abertos', (await call('GET', '/flash/invites', { token: b.token })).body?.received?.length === 0);
  check('desligar de novo é idempotente', (await call('DELETE', '/me/flash', { token: a.token })).status === 200);
  check('desligado: sai da lista dos outros', (await call('GET', '/flash/available', { token: b.token })).body?.items?.length === 0);

  await call('POST', '/me/flash', { token: a.token, body: { hours: 1 } });
  const inv4 = await call('POST', '/flash/invites', { token: a.token, body: { userId: b.id } });
  await call('POST', `/flash/invites/${inv4.body.id}/respond`, { token: b.token, body: { action: 'accept' } });
  await call('PUT', `/flash/matches/${inv4.body.id}/location`, { token: a.token, body: { lat: -23.5, lng: -46.6 } });

  console.log('\nConversas e sugestões');
  const acc = await call('POST', `/flash/invites/${inv4.body.id}/respond`, { token: b.token, body: { action: 'accept' } });
  check('aceitar de novo o convite já aceito falha (404)', acc.status === 404, acc.body);
  const matchView = await call('GET', `/flash/matches/${inv4.body.id}`, { token: a.token });
  const convId = matchView.body?.conversationId;
  check('o encontro traz a conversa dos dois', typeof convId === 'string', matchView.body);
  const early = await call('GET', `/flash/matches/${inv4.body.id}/suggestions`, { token: a.token });
  check('sugestões sem a localização dos dois: 409', early.status === 409, early.body);
  await call('PUT', `/flash/matches/${inv4.body.id}/location`, { token: b.token, body: { lat: -23.51, lng: -46.61 } });
  const sug = await call('GET', `/flash/matches/${inv4.body.id}/suggestions`, { token: a.token });
  check('sugestões com a localização dos dois: 200', sug.status === 200 && Array.isArray(sug.body?.items), sug.body);
  check('sugestão de quem não participa: 404', (await call('GET', `/flash/matches/${inv4.body.id}/suggestions`, { token: c.token })).status === 404);

  const list0 = await call('GET', '/conversations', { token: b.token });
  check('lista de conversas', list0.status === 200 && list0.body.items.some((i) => i.id === convId), list0.body);
  const opened = await call('POST', '/conversations', { token: b.token, body: { userId: a.id } });
  check('abrir a conversa com o amigo devolve a mesma', opened.body?.id === convId, opened.body);
  check('abrir conversa com quem não é amigo: 403', (await call('POST', '/conversations', { token: a.token, body: { userId: c.id } })).status === 403);
  const sent = await call('POST', `/conversations/${convId}/messages`, { token: a.token, body: { body: '  Bora tomar um café?  ' } });
  check('enviar mensagem', sent.status === 201 && sent.body?.body === 'Bora tomar um café?', sent.body);
  check('mensagem vazia: 400', (await call('POST', `/conversations/${convId}/messages`, { token: a.token, body: { body: '   ' } })).status === 400);
  const card = { source: 'OSM', title: 'Café Teste', venueName: 'Café Teste', lat: -23.52, lng: -46.62, startsAt: null, endsAt: null, sample: false, externalId: 'node/1' };
  const sentCard = await call('POST', `/conversations/${convId}/messages`, { token: a.token, body: { suggestion: card } });
  check('enviar sugestão', sentCard.status === 201 && sentCard.body?.kind === 'SUGGESTION', sentCard.body);
  const webm = `data:audio/webm;codecs=opus;base64,${Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(60).fill(5)]).toString('base64')}`;
  const voiceMsg = await call('POST', `/conversations/${convId}/messages`, { token: a.token, body: { audio: webm, audioMs: 3000 } });
  check('mensagem de voz: envia', voiceMsg.status === 200 && voiceMsg.body?.kind === 'AUDIO' && voiceMsg.body?.audio?.durationMs === 3000, voiceMsg.body);
  const voiceGet = await fetch(`${BASE}/conversations/${convId}/messages/${voiceMsg.body?.id}/audio`, { headers: { Authorization: `Bearer ${b.token}` } });
  check('mensagem de voz: o outro amigo baixa o áudio', voiceGet.status === 200 && (voiceGet.headers.get('content-type') ?? '').startsWith('audio/webm'));
  check('mensagem de voz: sem token, 401', (await fetch(`${BASE}/conversations/${convId}/messages/${voiceMsg.body?.id}/audio`)).status === 401);
  check('mensagem de voz: arquivo falso, 400', (await call('POST', `/conversations/${convId}/messages`, { token: a.token, body: { audio: 'data:audio/webm;base64,AAAA', audioMs: 3000 } })).status === 400);
  check('mensagem de voz: duração fora do limite, 400', (await call('POST', `/conversations/${convId}/messages`, { token: a.token, body: { audio: webm, audioMs: 95000 } })).status === 400);
  check('quem sugeriu não responde à própria sugestão (403)', (await call('POST', `/conversations/${convId}/messages/${sentCard.body?.id}/respond`, { token: a.token, body: { action: 'accept' } })).status === 403);
  const acceptedPlace = await call('POST', `/conversations/${convId}/messages/${sentCard.body?.id}/respond`, { token: b.token, body: { action: 'accept' } });
  check('aceitar o lugar sugerido', acceptedPlace.status === 200 && acceptedPlace.body?.response === 'ACCEPTED', acceptedPlace.body);
  check('responder duas vezes: 409', (await call('POST', `/conversations/${convId}/messages/${sentCard.body?.id}/respond`, { token: b.token, body: { action: 'decline' } })).status === 409);
  const withDist = await call('GET', `/conversations/${convId}/messages`, { token: a.token });
  const cardMsg = withDist.body?.messages?.find((m) => m.kind === 'SUGGESTION');
  check('cartão traz a distância dos dois enquanto o encontro está ativo', typeof cardMsg?.distances?.meM === 'number' && typeof cardMsg?.distances?.themM === 'number', cardMsg);
  const unreadList = await call('GET', '/conversations', { token: b.token });
  check('não lidas aparecem para quem recebeu', unreadList.body.items.find((i) => i.id === convId)?.unread >= 2, unreadList.body);
  const read = await call('GET', `/conversations/${convId}/messages`, { token: b.token });
  check('a foto do Google exige endereço assinado (404 sem assinatura)', (await call('GET', '/places/photo?ref=places/a/photos/b&exp=1&sig=x')).status === 404);
  check('ler as mensagens em ordem', read.status === 200 && read.body.messages.length >= 3 && read.body.messages[0].kind === 'SYSTEM' && /^Flash combinado/.test(read.body.messages[0].body) && read.body.messages.some((m) => m.kind === 'SUGGESTION') && read.body.messages.at(-1).kind === 'AUDIO' && read.body.canSend === true, read.body);
  check('abrir marcou como lida', (await call('GET', '/conversations', { token: b.token })).body.items.find((i) => i.id === convId)?.unread === 0);
  const shared = await call('GET', `/conversations/${convId}/shared`, { token: b.token });
  check('informações da conversa: tipo, pessoa, voz e links', shared.status === 200 && shared.body?.type === 'DIRECT' && shared.body?.other?.userId === a.id && shared.body?.voice?.length >= 1 && Array.isArray(shared.body?.links), shared.body);
  check('informações da conversa: quem não participa recebe 404', (await call('GET', `/conversations/${convId}/shared`, { token: c.token })).status === 404);
  check('denunciar conversa: motivo inválido dá 400', (await call('POST', `/conversations/${convId}/report`, { token: b.token, body: { reason: 'X' } })).status === 400);
  check('denunciar conversa (grava ConversationReport)', (await call('POST', `/conversations/${convId}/report`, { token: b.token, body: { reason: 'SPAM', details: 'teste' } })).status === 200);
  check('denunciar de novo atualiza, sem erro', (await call('POST', `/conversations/${convId}/report`, { token: b.token, body: { reason: 'OTHER' } })).status === 200);
  check('limpar conversa (grava clearedAt só para quem limpou)', (await call('POST', `/conversations/${convId}/clear`, { token: b.token })).status === 200);
  check('limpar: quem limpou não vê mais mensagens', (await call('GET', `/conversations/${convId}/messages`, { token: b.token })).body?.messages?.length === 0);
  check('limpar: a outra pessoa continua vendo', (await call('GET', `/conversations/${convId}/messages`, { token: a.token })).body?.messages?.length >= 3);
  check('limpar: quem não participa recebe 404', (await call('POST', `/conversations/${convId}/clear`, { token: c.token })).status === 404);
  check('quem não participa não lê (404)', (await call('GET', `/conversations/${convId}/messages`, { token: c.token })).status === 404);
  check('id inválido: 400', (await call('GET', '/conversations/xyz/messages', { token: a.token })).status === 400);
  check('sem login: 401', (await call('GET', '/conversations')).status === 401);

  console.log('\nExplorar');
  const ex = await call('GET', '/explore?lat=-23.55&lng=-46.63&radiusKm=10', { token: a.token });
  check('explorar sem texto devolve eventos perto', ex.status === 200 && ex.body.mode === 'NEARBY' && Array.isArray(ex.body.events) && ex.body.located === true, ex.body);
  const exq = await call('GET', '/explore?q=%23samba', { token: a.token });
  check('busca por # responde', exq.status === 200 && exq.body.mode === 'TAG' && Array.isArray(exq.body.tags), exq.body);
  check('busca por texto traz pessoas, locais e eventos', (await call('GET', '/explore?q=ana', { token: a.token })).body.people !== undefined);
  check('raio inválido: 400', (await call('GET', '/explore?radiusKm=999', { token: a.token })).status === 400);
  check('tipo inválido: 400', (await call('GET', '/explore?kind=FESTA', { token: a.token })).status === 400);
  check('evento inexistente: 404', (await call('GET', '/events/nao-existe', { token: a.token })).status === 404);
  const uev = await call('POST', '/posts', { token: a.token, body: { images: [tinyJpeg], placeName: 'Parque de teste', event: { title: 'Corrida de teste', kind: 'SPORT', startsAt: new Date(Date.now() + 86_400_000).toISOString() } } });
  check('criar evento com tipo Esporte', uev.status === 200 && uev.body.event?.kind === 'SPORT', uev.body);
  const evp = await call('GET', `/events/${uev.body.id}`, { token: a.token });
  check('página do evento da pessoa: dono, capa e 1 confirmado', evp.status === 200 && evp.body.source === 'USER' && evp.body.isOwner === true && evp.body.confirmedCount === 1 && evp.body.coverPath?.startsWith('/posts/images/'), evp.body);
  const evPost = await call('POST', `/events/${uev.body.id}/posts`, { token: a.token, body: { caption: 'Ponto de encontro' } });
  check('dono posta no evento', evPost.status === 200 && evPost.body.mine === true, evPost.body);
  check('Eu vou em evento inexistente: 404', (await call('POST', '/events/nao-existe/going', { token: a.token })).status === 404);
  const evOpen = await call('PUT', `/events/${uev.body.id}/posts-public`, { token: a.token, body: { public: true } });
  check('dono abre os posts para quem vai', evOpen.status === 200 && evOpen.body.postsPublic === true, evOpen.body);
  check('explorar sem login: 401', (await call('GET', '/explore')).status === 401);

  console.log('\nPosts');
  const post = await call('POST', '/posts', { token: a.token, body: { caption: 'Post de teste', images: [tinyJpeg, tinyJpeg] } });
  check('criar post com 2 fotos', post.status === 200 && post.body.images.length === 2 && post.body.images[0].path.startsWith('/posts/images/'), post.body);
  const postImg = await fetch(`${BASE}${post.body?.images?.[0]?.path ?? '/posts/images/x'}`);
  check('foto do post é servida como imagem, sem login', postImg.status === 200 && /image\/jpeg/.test(postImg.headers.get('content-type') ?? ''), postImg.status);
  check('post sem fotos: 400', (await call('POST', '/posts', { token: a.token, body: { images: [] } })).status === 400);
  check('foto de lugar com endereço falso: 400', (await call('POST', '/posts', { token: a.token, body: { images: [{ photoPath: '/places/photo?ref=x&exp=1&sig=y' }] } })).status === 400);
  const aPosts = await call('GET', `/profiles/${a.username}/posts`, { token: b.token });
  check('amigo vê os posts do perfil', aPosts.status === 200 && aPosts.body.total === 1, aPosts.body);
  check('feed traz o post do amigo', (await call('GET', '/posts/feed', { token: b.token })).body?.items?.some((p) => p.id === post.body.id));
  const tagged = await call('POST', '/posts', { token: a.token, body: { images: [tinyJpeg], tagUserIds: [b.id] } });
  check('marcar amigo: fica pendente', tagged.status === 200 && tagged.body.tags?.[0]?.status === 'PENDING', tagged.body);
  check('marcado vê a marcação pendente', (await call('GET', '/posts/pending-tags', { token: b.token })).body?.items?.some((p) => p.id === tagged.body.id));
  check('marcar quem não é amigo: 400', (await call('POST', '/posts', { token: a.token, body: { images: [tinyJpeg], tagUserIds: [c.id] } })).status === 400);
  check('marcado aceita', (await call('POST', `/posts/${tagged.body.id}/tag`, { token: b.token, body: { action: 'accept' } })).body?.status === 'ACCEPTED');
  check('quem não foi marcado não responde: 404', (await call('POST', `/posts/${tagged.body.id}/tag`, { token: c.token, body: { action: 'accept' } })).status === 404);
  const lk = await call('POST', `/posts/${post.body.id}/like`, { token: b.token });
  check('amigo curte o post', lk.status === 200 && lk.body?.liked === true && lk.body?.likeCount === 1, lk.body);
  const cm = await call('POST', `/posts/${post.body.id}/comments`, { token: b.token, body: { body: 'Bora!' } });
  check('amigo comenta', cm.status === 200 && cm.body?.body === 'Bora!', cm.body);
  check('lista comentários', (await call('GET', `/posts/${post.body.id}/comments`, { token: a.token })).body?.items?.length === 1);
  check('não-autor não edita: 403', (await call('PATCH', `/posts/${post.body.id}`, { token: b.token, body: { caption: 'x' } })).status === 403);
  check('autor edita legenda', (await call('PATCH', `/posts/${post.body.id}`, { token: a.token, body: { caption: 'Editada' } })).body?.edited === true);
  check('autor arquiva', (await call('POST', `/posts/${post.body.id}/archive`, { token: a.token })).status === 200);
  check('arquivado some p/ outros: 404', (await call('GET', `/posts/${post.body.id}`, { token: b.token })).status === 404);
  check('autor desarquiva', (await call('DELETE', `/posts/${post.body.id}/archive`, { token: a.token })).status === 200);
  check('autor não denuncia o próprio: 403', (await call('POST', `/posts/${post.body.id}/report`, { token: a.token, body: { reason: 'SPAM' } })).status === 403);
  check('outra pessoa não apaga: 404', (await call('DELETE', `/posts/${post.body.id}`, { token: b.token })).status === 404);
  check('autor apaga', (await call('DELETE', `/posts/${post.body.id}`, { token: a.token })).status === 200);

  console.log('\nEncontros e grupos');
  const anyEvent = (await call('GET', '/explore?radiusKm=50', { token: a.token })).body?.events?.[0];
  if (!anyEvent) {
    console.log('  (pulado: não há evento no banco. Rode "cd apps/api && npm run seed:places -- --here" e repita.)');
  } else {
    const one = await call('POST', '/meetups', { token: a.token, body: { eventId: anyEvent.id, guestIds: [b.id] } });
    check('criar encontro com 1 pessoa (sem grupo)', one.status === 200 && one.body.isGroup === false && one.body.myStatus === 'ORGANIZER', one.body);
    check('convidado vê o convite', (await call('GET', `/meetups/${one.body.id}`, { token: b.token })).body?.myStatus === 'INVITED');
    check('quem não foi convidado não vê (404)', (await call('GET', `/meetups/${one.body.id}`, { token: c.token })).status === 404);
    const acc = await call('POST', `/meetups/${one.body.id}/respond`, { token: b.token, body: { action: 'accept' } });
    check('convidado aceita', acc.status === 200 && acc.body.myStatus === 'CONFIRMED', acc.body);
    check('responder de novo: 409', (await call('POST', `/meetups/${one.body.id}/respond`, { token: b.token, body: { action: 'decline' } })).status === 409);
    check('convidar quem não é amigo: 403', (await call('POST', '/meetups', { token: a.token, body: { eventId: anyEvent.id, guestIds: [c.id] } })).status === 403);
    check('sem convidados: 400', (await call('POST', '/meetups', { token: a.token, body: { eventId: anyEvent.id, guestIds: [] } })).status === 400);
    check('grupo só existe com vários convidados (404 na 1 a 1)', (await call('GET', `/conversations/${one.body.conversationId}/group`, { token: a.token })).status === 404);
    check('convidar mais gente num encontro de 2: 400', (await call('POST', `/meetups/${one.body.id}/invite`, { token: a.token, body: { guestIds: [c.id] } })).status === 400);
    check('só quem organiza renomeia: 403', (await call('PATCH', `/meetups/${one.body.id}`, { token: b.token, body: { title: 'x' } })).status === 403);
    const renamed = await call('PATCH', `/meetups/${one.body.id}`, { token: a.token, body: { title: 'Nome de teste' } });
    check('organizador renomeia o encontro', renamed.status === 200 && renamed.body.title === 'Nome de teste', renamed.body);
    check('sair de uma conversa 1 a 1 como grupo: 404', (await call('POST', `/conversations/${one.body.conversationId}/leave`, { token: b.token })).status === 404);

    const posted = await call('POST', `/events/${anyEvent.id}/post`, { token: a.token });
    check('postar evento no perfil', posted.status === 200 || posted.status === 201, posted.body);
    const mine = await call('GET', `/profiles/${a.username}/events`, { token: b.token });
    check('amigo vê o evento postado', mine.status === 200 && mine.body.total === 1 && mine.body.items[0].id === anyEvent.id, mine.body);
    const shared = await call('POST', `/conversations/${one.body.conversationId}/messages`, { token: a.token, body: { eventId: anyEvent.id } });
    check('enviar evento numa conversa', shared.status === 200 || shared.status === 201 ? shared.body?.kind === 'EVENT' : false, shared.body);
    check('tirar evento do perfil', (await call('DELETE', `/events/${anyEvent.id}/post`, { token: a.token })).status === 200);

    console.log('\nAvisos');
    const news = await call('GET', '/notifications', { token: b.token });
    check('convidado recebeu aviso do encontro', news.status === 200 && news.body.items.some((n) => n.type === 'MEETUP_INVITE') && news.body.unread >= 1, news.body);
    check('contagem de não lidos', (await call('GET', '/notifications/unread', { token: b.token })).body?.unread >= 1);
    const firstNews = news.body.items.find((n) => n.type === 'MEETUP_INVITE');
    const read = await call('POST', '/notifications/read', { token: b.token, body: { id: firstNews.id } });
    check('marcar um aviso como lido', read.status === 200 && read.body.unread < news.body.unread, read.body);
    check('marcar todos como lidos', (await call('POST', '/notifications/read', { token: b.token, body: {} })).body?.unread === 0);
    const key = await call('GET', '/notifications/push-key', { token: b.token });
    check('chave pública do push (ou null se não configurado)', key.status === 200 && (key.body.publicKey === null || typeof key.body.publicKey === 'string'), key.body);
    check('inscrição inválida: 400 ou 409', [400, 409].includes((await call('POST', '/notifications/push', { token: b.token, body: { endpoint: 'http://x', keys: {} } })).status));
    check('avisos sem login: 401', (await call('GET', '/notifications')).status === 401);

  }

  console.log('\nBloqueio');
  const block = await call('POST', `/users/${b.id}/block`, { token: a.token });
  check('bloquear', block.status === 200, block.body);
  const friendsAfter = await call('GET', '/me/friends', { token: a.token });
  check('bloqueio encerra a amizade', friendsAfter.body?.length === 0, friendsAfter.body);
  check('bloquear encerra o encontro do Flash e apaga a posição (404)', (await call('GET', `/flash/matches/${inv4.body.id}`, { token: b.token })).status === 404);
  check('bloqueado some da lista de Flash', (await call('GET', '/flash/available', { token: b.token })).body?.items?.length === 0);
  const blockedView = await call('GET', `/profiles/${a.username}`, { token: b.token });
  check('quem foi bloqueado não encontra o perfil (404)', blockedView.status === 404, blockedView.body);
  const blockedFollow = await call('POST', `/users/${a.id}/follow`, { token: b.token });
  check('quem foi bloqueado não consegue seguir', blockedFollow.status === 404 || blockedFollow.status === 403, blockedFollow.body);
  const blockedList = await call('GET', '/me/blocks', { token: a.token });
  check('lista de bloqueados', blockedList.body?.length === 1, blockedList.body);
  check('bloquear esconde a conversa dos dois', (await call('GET', `/conversations/${convId}/messages`, { token: b.token })).status === 404 && (await call('GET', '/conversations', { token: a.token })).body.items.every((i) => i.id !== convId));
  const unblock = await call('DELETE', `/users/${b.id}/block`, { token: a.token });
  check('desbloquear', unblock.status === 200 && unblock.body.removed === true, unblock.body);
} catch (error) {
  failed += 1;
  console.log(`\nERRO NO TESTE: ${error instanceof Error ? error.message : error}`);
}

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
