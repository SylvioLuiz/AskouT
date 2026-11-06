// Prepara o perfil de desenvolvimento do build iOS usando SEMPRE o certificado fixo (o .p12 do segredo).
// Assim o Xcode não precisa criar certificado nenhum (evita o erro "máximo de certificados").
// Passos: acha na Apple o certificado com o número de série do .p12, cria um perfil novo
// (iOS App Development) com ele e todos os iPhones cadastrados, e instala o perfil no Mac.
// Usa a mesma chave da API do App Store Connect do fluxo (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID).
// Entrada: CERT_SERIAL (número de série do certificado, em hexadecimal).
// Saída: imprime o nome do perfil e grava PROFILE_NAME em $GITHUB_ENV.
import { createPrivateKey, sign } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BUNDLE_ID = process.env.BUNDLE_ID ?? 'br.com.askout';
const PROFILE_NAME = process.env.PROFILE_NAME ?? 'AskouT CI Development';
const { ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID, CERT_SERIAL } = process.env;
if (!ASC_KEY_PATH || !ASC_KEY_ID || !ASC_ISSUER_ID) throw new Error('Faltam ASC_KEY_PATH, ASC_KEY_ID ou ASC_ISSUER_ID.');
if (!CERT_SERIAL) throw new Error('Falta CERT_SERIAL (número de série do certificado do .p12).');

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
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// 1. Certificado: o mesmo do .p12, comparando o número de série.
const norm = (s) => String(s).toUpperCase().replace(/[^0-9A-F]/g, '').replace(/^0+/, '');
const certs = (await api('/v1/certificates?limit=200&fields[certificates]=name,serialNumber,certificateType,expirationDate')).data ?? [];
const cert = certs.find((c) => norm(c.attributes.serialNumber) === norm(CERT_SERIAL));
if (!cert) {
  throw new Error(`O certificado do .p12 (série ${CERT_SERIAL}) não está mais na conta da Apple (revogado ou de outro time). Exporte um certificado válido e atualize o segredo IOS_DEV_CERT_P12_BASE64.`);
}
console.log(`Certificado fixo: ${cert.attributes.name} (${cert.attributes.certificateType}), vence em ${cert.attributes.expirationDate}.`);

// 2. App (bundle id).
const bundles = (await api(`/v1/bundleIds?filter[identifier]=${encodeURIComponent(BUNDLE_ID)}&limit=200`)).data ?? [];
const bundle = bundles.find((b) => b.attributes.identifier === BUNDLE_ID);
if (!bundle) throw new Error(`Bundle id ${BUNDLE_ID} não encontrado na conta.`);

// 3. iPhones cadastrados (o perfil de desenvolvimento exige pelo menos um).
const devices = (await api('/v1/devices?filter[platform]=IOS&filter[status]=ENABLED&limit=200')).data ?? [];
if (!devices.length) throw new Error('Nenhum iPhone cadastrado na conta: o perfil de desenvolvimento precisa de pelo menos um.');

// 4. Perfil: apaga o anterior com o mesmo nome e cria um novo (pega aparelhos novos e nunca fica vencido).
const old = (await api(`/v1/profiles?filter[name]=${encodeURIComponent(PROFILE_NAME)}&limit=200`)).data ?? [];
for (const p of old) await api(`/v1/profiles/${p.id}`, { method: 'DELETE' });
const created = await api('/v1/profiles', {
  method: 'POST',
  body: JSON.stringify({
    data: {
      type: 'profiles',
      attributes: { name: PROFILE_NAME, profileType: 'IOS_APP_DEVELOPMENT' },
      relationships: {
        bundleId: { data: { type: 'bundleIds', id: bundle.id } },
        certificates: { data: [{ type: 'certificates', id: cert.id }] },
        devices: { data: devices.map((d) => ({ type: 'devices', id: d.id })) },
      },
    },
  }),
});
const { uuid, profileContent } = created.data.attributes;

// 5. Instala nas duas pastas que o Xcode lê (a antiga e a do Xcode 16+).
const content = Buffer.from(profileContent, 'base64');
for (const dir of [join(homedir(), 'Library/MobileDevice/Provisioning Profiles'), join(homedir(), 'Library/Developer/Xcode/UserData/Provisioning Profiles')]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${uuid}.mobileprovision`), content);
}
console.log(`Perfil "${PROFILE_NAME}" criado com ${devices.length} aparelho(s) e instalado (${uuid}).`);
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PROFILE_NAME=${PROFILE_NAME}\n`);
