// Confere, antes de gerar o app, se a versão de marketing (MARKETING_VERSION) ainda aceita builds novas.
// A Apple fecha a versão assim que ela é enviada para revisão ou aprovada; aí o envio só falha lá no fim
// (no -exportArchive), com "train version is closed" ou "must contain a higher version". Aqui falha em segundos.
// Usa a mesma chave da API do App Store Connect do fluxo (ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID).
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Estados em que a versão ainda aceita uma build nova. Qualquer outro (em revisão, aprovada, à venda...) fecha.
const OPEN = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED', 'METADATA_REJECTED', 'INVALID_BINARY']);

/** Lê as MARKETING_VERSION do projeto; todas precisam ser iguais (app e extensões). */
export function marketingVersions(pbxproj) {
  return [...new Set([...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim()))];
}

export function compare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function nextPatch(v) {
  const p = v.split('.').map(Number);
  while (p.length < 3) p.push(0);
  p[p.length - 1]++;
  return p.join('.');
}

/** versions: [{ version, state }]. Devolve null se a versão serve, ou o motivo e a sugestão se não serve. */
export function check(current, versions) {
  const closed = versions.filter((v) => !OPEN.has(v.state));
  const same = versions.find((v) => v.version === current);
  const higherClosed = closed.filter((v) => compare(v.version, current) >= 0).sort((a, b) => compare(b.version, a.version));
  if (!higherClosed.length) return null;
  const top = [current, ...versions.map((v) => v.version)].sort(compare).at(-1);
  const reason = same && !OPEN.has(same.state)
    ? `A versão ${current} já está fechada na Apple (${same.state}).`
    : `A versão ${current} não é maior que a ${higherClosed[0].version}, já fechada na Apple (${higherClosed[0].state}).`;
  return { reason, suggestion: nextPatch(top) };
}

const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');
function token({ ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID }) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'ES256', kid: ASC_KEY_ID, typ: 'JWT' });
  const body = b64({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' });
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: createPrivateKey(readFileSync(ASC_KEY_PATH)), dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

async function main() {
  const env = process.env;
  const APP_ID = env.ASC_APP_ID ?? '6826608065';
  const PBXPROJ = env.PBXPROJ ?? 'apps/mobile/ios/App/App.xcodeproj/project.pbxproj';

  const found = marketingVersions(readFileSync(PBXPROJ, 'utf8'));
  if (found.length !== 1) {
    console.log(`::error::MARKETING_VERSION diferente entre o app e as extensões (${found.join(', ') || 'nenhuma'}). A Apple recusa: deixe todas iguais no project.pbxproj.`);
    process.exit(1);
  }
  const current = found[0];

  let versions;
  try {
    if (!env.ASC_KEY_PATH || !env.ASC_KEY_ID || !env.ASC_ISSUER_ID) throw new Error('faltam ASC_KEY_PATH, ASC_KEY_ID ou ASC_ISSUER_ID');
    const res = await fetch(
      `https://api.appstoreconnect.apple.com/v1/apps/${APP_ID}/appStoreVersions?filter[platform]=IOS&limit=200&fields[appStoreVersions]=versionString,appVersionState,appStoreState`,
      { headers: { Authorization: `Bearer ${token(env)}` } },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 300)}`);
    versions = (JSON.parse(text).data ?? []).map((d) => ({
      version: d.attributes.versionString,
      state: d.attributes.appVersionState ?? d.attributes.appStoreState,
    }));
  } catch (e) {
    // Sem resposta da Apple não dá para saber; segue o build (o envio no fim ainda acusa, se for o caso).
    console.log(`::warning::Não deu para conferir a versão ${current} na Apple: ${String(e.message).slice(0, 200)}`);
    return;
  }

  console.log(`Versão no projeto: ${current}. Na Apple: ${versions.map((v) => `${v.version} (${v.state})`).join(', ') || 'nenhuma'}.`);
  const problem = check(current, versions);
  if (problem) {
    const msg = `${problem.reason} Suba MARKETING_VERSION para ${problem.suggestion} em todos os alvos do project.pbxproj (app e extensões).`;
    console.log(`::error::${msg}`);
    if (env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(env.GITHUB_STEP_SUMMARY, `### Versão ${current} fechada na Apple\n${msg}\n`);
    }
    process.exit(1);
  }
  console.log(`Versão ${current} aceita builds novas.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
