// Expira no TestFlight as builds mais antigas, deixando só as últimas KEEP (padrão 10).
// A Apple não deixa apagar builds: expirar tira a build da lista dos testadores.
// Usa a mesma chave da API do App Store Connect do fluxo (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const APP_ID = process.env.ASC_APP_ID ?? '6826608065';
const KEEP = Number(process.env.KEEP ?? 10);
const { ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID } = process.env;
if (!ASC_KEY_PATH || !ASC_KEY_ID || !ASC_ISSUER_ID) throw new Error('Faltam ASC_KEY_PATH, ASC_KEY_ID ou ASC_ISSUER_ID.');

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
  const body = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(readFileSync(ASC_KEY_PATH)), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

const jwt = token();
async function api(path, init = {}) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// Mais novas primeiro.
const list = await api(`/v1/builds?filter[app]=${APP_ID}&sort=-uploadedDate&limit=200&fields[builds]=version,uploadedDate,expired,processingState`);
const builds = list.data ?? [];
const old = builds.slice(KEEP).filter((b) => b.attributes.expired !== true);
console.log(`${builds.length} builds no TestFlight; mantendo as ${Math.min(KEEP, builds.length)} mais novas; expirando ${old.length}.`);

let done = 0;
for (const b of old) {
  try {
    await api(`/v1/builds/${b.id}`, { method: 'PATCH', body: JSON.stringify({ data: { type: 'builds', id: b.id, attributes: { expired: true } } }) });
    done++;
    console.log(`Build ${b.attributes.version} expirada.`);
  } catch (e) {
    // Ex.: build ligada a uma versão em análise ou publicada: a Apple recusa, e tudo bem.
    console.log(`Build ${b.attributes.version} mantida: ${String(e.message).slice(0, 160)}`);
  }
}
console.log(`Pronto: ${done} expiradas.`);
