// Deixa o ambiente em dia sempre que o AskouT sobe, mesmo sem acesso ao GitHub:
// se o schema do banco, as migrações, os SQLs ou o package-lock mudaram desde a última vez, refaz só o necessário
// (npm install, prisma generate, migrações e SQLs no banco principal). Se nada mudou, não faz nada.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'apps/api');
const stampFile = join(root, '.askout-setup-stamp');

function hashFiles(files) {
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f);
    if (existsSync(f)) h.update(readFileSync(f));
  }
  return h.digest('hex');
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]))
    .sort();
}

function stamp() {
  return {
    deps: hashFiles([join(root, 'package-lock.json')]),
    db: hashFiles([join(api, 'prisma/schema.prisma'), ...listFiles(join(api, 'prisma/migrations')), ...listFiles(join(api, 'prisma/sql'))]),
  };
}

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(api, '.env');
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
  return line?.replace(/^DATABASE_URL=/, '').trim().replace(/^["']|["']$/g, '');
}

function run(title, cwd, command, args, env = {}, tolerate) {
  console.log(`[setup] ${title}…`);
  const r = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status === 0 || (tolerate && tolerate.test(out))) return true;
  console.log(`[setup] FALHOU: ${title}\n${out.trim().split('\n').slice(-8).join('\n')}`);
  return false;
}

/** Retorna true se tudo está em dia ao final. */
export function ensureSetup() {
  let saved = {};
  try {
    saved = JSON.parse(readFileSync(stampFile, 'utf8'));
  } catch {
    // primeira vez
  }
  const now = stamp();
  let ok = true;
  if (saved.deps !== now.deps) ok = run('instalando dependências (npm install)', root, 'npm', ['install', '--no-audit', '--no-fund']) && ok;
  if (saved.db !== now.db) {
    const url = databaseUrl();
    if (!url) {
      console.log('[setup] DATABASE_URL não encontrada em apps/api/.env; pulei o banco.');
      ok = false;
    } else {
      ok = run('atualizando o cliente do banco (prisma generate)', api, 'npx', ['prisma', 'generate']) && ok;
      ok = run('aplicando migrações no banco', api, 'npx', ['prisma', 'migrate', 'deploy'], { DATABASE_URL: url }) && ok;
      for (const f of readdirSync(join(api, 'prisma/sql')).filter((x) => x.endsWith('.sql')).sort()) {
        ok = run(`aplicando ${f}`, api, 'npx', ['prisma', 'db', 'execute', '--file', join('prisma/sql', f), '--schema', 'prisma/schema.prisma'], { DATABASE_URL: url }, /already exists|duplicate_object/i) && ok;
      }
    }
  }
  if (ok) writeFileSync(stampFile, JSON.stringify(now));
  else console.log('[setup] Algo não deu certo (veja acima). Subindo mesmo assim; me mande esta janela.');
  return ok;
}
