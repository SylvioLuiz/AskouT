// Atualiza e confere o ambiente inteiro com UM comando:  npm run update
//
//   git pull → npm install → migrações e SQL nos bancos (principal e de teste) → testes da API (com Postgres real)
//   → typecheck da API → typecheck e testes da web.
//
// Pode rodar quantas vezes quiser (tudo é idempotente). O relatório completo fica em .askout-update.log na raiz:
// é só mandar "li o relatório" para o Claude, que lê o arquivo sozinho — sem copiar e colar a saída.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const web = join(root, 'apps/web');
const logFile = join(root, '.askout-update.log');
writeFileSync(logFile, `AskouT update — ${new Date().toISOString()}\n`);

const results = [];
function log(text) {
  appendFileSync(logFile, `${text}\n`);
}

/** Roda um comando, guarda a saída no relatório e mostra o resultado numa linha. */
function step(title, cwd, command, args, { env = {}, tolerate, optional = false } = {}) {
  process.stdout.write(`▸ ${title}… `);
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  log(`\n=== ${title}\n$ ${command} ${args.join(' ')}\n${output}\n(código ${result.status ?? result.error?.message})`);
  let ok = result.status === 0;
  let note = '';
  if (!ok && tolerate?.test(output)) {
    ok = true;
    note = ' (já aplicado)';
  }
  const tail = output.trim().split('\n').slice(-3).join(' | ');
  console.log(ok ? `ok${note}` : `FALHOU\n    ${tail}`);
  results.push({ title, ok, optional });
  return { ok, output };
}

function dbUrls() {
  let main = process.env.DATABASE_URL;
  const envFile = join(api, '.env');
  if (!main && existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    main = line?.replace(/^DATABASE_URL=/, '').trim().replace(/^["']|["']$/g, '');
  }
  if (!main) return undefined;
  let test = process.env.ASKOUT_TEST_DATABASE_URL;
  if (!test) {
    const url = new URL(main);
    const name = url.pathname.replace(/^\//, '');
    url.pathname = `/${name.endsWith('_test') ? name : `${name}_test`}`;
    test = url.toString();
  }
  return { main, test };
}

// 1. Código
step('git pull', root, 'git', ['pull', '--ff-only']).ok ||
  (step('descartar package-lock.json local', root, 'git', ['checkout', 'package-lock.json']).ok && step('git pull (de novo)', root, 'git', ['pull', '--ff-only']));
step('npm install', root, 'npm', ['install', '--no-audit', '--no-fund']);

// 2. Bancos
const urls = dbUrls();
if (!urls) {
  console.log('✘ DATABASE_URL não encontrada em apps/api/.env');
  results.push({ title: 'DATABASE_URL', ok: false });
} else {
  step('prisma generate', api, 'npx', ['prisma', 'generate']);
  const sqlDir = join(api, 'prisma/sql');
  const sqlFiles = readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
  for (const [label, url] of [['principal', urls.main], ['teste', urls.test]]) {
    const dbName = new URL(url).pathname.slice(1);
    step(`banco ${label} (${dbName}): migrações`, api, 'npx', ['prisma', 'migrate', 'deploy'], { env: { DATABASE_URL: url } });
    for (const file of sqlFiles) {
      step(`banco ${label}: ${file}`, api, 'npx', ['prisma', 'db', 'execute', '--file', join('prisma/sql', file), '--schema', 'prisma/schema.prisma'], {
        env: { DATABASE_URL: url },
        tolerate: /already exists|duplicate_object/i,
      });
    }
  }
  // 3. Testes e tipos
  step('API: testes (com Postgres real)', api, 'npm', ['test'], { env: { ASKOUT_TEST_DATABASE_URL: urls.test } });
}
step('API: typecheck completo', api, 'npm', ['run', 'typecheck:full']);
step('Web: typecheck', web, 'npm', ['run', 'typecheck']);
step('Web: testes', web, 'npm', ['test']);

const failed = results.filter((r) => !r.ok && !r.optional);
console.log(failed.length === 0 ? '\n✔ Tudo certo.' : `\n✘ ${failed.length} etapa(s) com problema: ${failed.map((r) => r.title).join('; ')}`);
console.log(`Relatório completo: ${logFile}`);
log(`\nRESUMO: ${failed.length === 0 ? 'tudo certo' : `falhou: ${failed.map((r) => r.title).join('; ')}`}`);
process.exit(failed.length === 0 ? 0 : 1);
