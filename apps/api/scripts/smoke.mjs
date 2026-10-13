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
  check('quem sugeriu não responde à própria sugestão (403)', (await call('POST', `/conversations/${convId}/messages/${sentCard.body?.id}/respond`, { token: a.token, body: { action: 'accept' } })).status === 403);
  const acceptedPlace = await call('POST', `/conversations/${convId}/messages/${sentCard.body?.id}/respond`, { token: b.token, body: { action: 'accept' } });
  check('aceitar o lugar sugerido', acceptedPlace.status === 200 && acceptedPlace.body?.response === 'ACCEPTED', acceptedPlace.body);
  check('responder duas vezes: 409', (await call('POST', `/conversations/${convId}/messages/${sentCard.body?.id}/respond`, { token: b.token, body: { action: 'decline' } })).status === 409);
  const withDist = await call('GET', `/conversations/${convId}/messages`, { token: a.token });
  const cardMsg = withDist.body?.messages?.find((m) => m.kind === 'SUGGESTION');
  check('cartão traz a distância dos dois enquanto o encontro está ativo', typeof cardMsg?.distances?.meM === 'number' && typeof cardMsg?.distances?.themM === 'number', cardMsg);
  const unreadList = await call('GET', '/conversations', { token: b.token });
  check('não lidas aparecem para quem recebeu', unreadList.body.items.find((i) => i.id === convId)?.unread === 2, unreadList.body);
  const read = await call('GET', `/conversations/${convId}/messages`, { token: b.token });
  check('a foto do Google exige endereço assinado (404 sem assinatura)', (await call('GET', '/places/photo?ref=places/a/photos/b&exp=1&sig=x')).status === 404);
  check('ler as mensagens em ordem', read.status === 200 && read.body.messages.length === 2 && read.body.messages[1].kind === 'SUGGESTION' && read.body.canSend === true, read.body);
  check('abrir marcou como lida', (await call('GET', '/conversations', { token: b.token })).body.items.find((i) => i.id === convId)?.unread === 0);
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
  check('explorar sem login: 401', (await call('GET', '/explore')).status === 401);

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
