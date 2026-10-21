// Sobe tudo para desenvolver, com um comando só:  npm run dev:all   (ou  npm run dev:all -- --https)
//
//  1. confere se o Postgres está rodando (no macOS tenta abrir o Postgres.app e espera);
//  2. libera as portas 3000 (API), 5173 (web) e 5174 (gestão) se sobrou processo de antes;
//  3. sobe a API, o app web e a plataforma de gestão (só computador), com a saída da API gravada em ~/askout-api.log (o smoke test lê o código de cadastro de lá);
//  4. Ctrl+C encerra tudo.
//
// Com --update: antes de subir, busca novidades no GitHub e, se houver, roda o `npm run update` (pull, instalação,
// migrações, testes). Sem internet ou sem novidades, segue direto. É o que o AskouT.command usa.
//
// Internet não é necessária: API, banco e app rodam na sua máquina. Só os tiles do mapa vêm da internet.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const useHttps = process.argv.includes('--https');
const logPath = process.env.ASKOUT_API_LOG ?? join(homedir(), 'askout-api.log');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function databaseHostPort() {
  // Lê DATABASE_URL do .env da API, sem depender de nenhuma biblioteca.
  const envFile = join(root, 'apps/api/.env');
  let url = process.env.DATABASE_URL;
  if (!url && existsSync(envFile)) {
    const line = spawnSync('grep', ['^DATABASE_URL=', envFile], { encoding: 'utf8' }).stdout.trim();
    url = line.replace(/^DATABASE_URL=/, '').replace(/^["']|["']$/g, '');
  }
  try {
    const parsed = new URL(url ?? '');
    return { host: parsed.hostname || 'localhost', port: parsed.port || '5432' };
  } catch {
    return { host: 'localhost', port: '5432' };
  }
}

function postgresReady({ host, port }) {
  const candidates = ['pg_isready', '/Applications/Postgres.app/Contents/Versions/latest/bin/pg_isready'];
  for (const bin of candidates) {
    const result = spawnSync(bin, ['-h', host, '-p', port], { encoding: 'utf8' });
    if (!result.error) return result.status === 0;
  }
  // Sem pg_isready: tenta abrir a porta TCP.
  const probe = spawnSync(process.execPath, ['-e', `require('net').connect(${Number(port)},'${host}').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))`]);
  return probe.status === 0;
}

async function ensurePostgres() {
  const target = databaseHostPort();
  if (postgresReady(target)) return console.log(`[dev] Postgres ok em ${target.host}:${target.port}`);
  if (process.platform === 'darwin' && existsSync('/Applications/Postgres.app')) {
    console.log('[dev] Postgres parado: abrindo o Postgres.app…');
    spawnSync('open', ['-a', 'Postgres']);
  } else {
    console.log('[dev] Postgres não responde; inicie o seu serviço do Postgres.');
  }
  for (let i = 0; i < 30; i += 1) {
    await sleep(1000);
    if (postgresReady(target)) return console.log('[dev] Postgres ok');
  }
  console.error('[dev] O Postgres não respondeu em 30 s. Abra o Postgres.app, clique em Start e rode de novo.');
  process.exit(1);
}

function freePort(port) {
  const pids = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' }).stdout.split(/\s+/).filter(Boolean);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGTERM');
      console.log(`[dev] liberei a porta ${port} (processo ${pid})`);
    } catch {
      /* já tinha saído */
    }
  }
}

function start(name, cwd, command, args, env, logFile) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sink = logFile ? createWriteStream(logFile, { flags: 'w' }) : undefined;
  const pipe = (stream, out) =>
    stream.on('data', (chunk) => {
      sink?.write(chunk);
      for (const line of chunk.toString().split('\n')) if (line.trim() !== '') out.write(`[${name}] ${line}\n`);
    });
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    console.log(`[dev] ${name} saiu (código ${code}).`);
    shutdown(code ?? 1);
  });
  return child;
}

const children = [];
let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await ensurePostgres();
if (process.argv.includes('--update')) {
  // Sem internet o git fica pendurado até estourar o tempo; 10 s bastam para saber, e a subida não espera mais que isso.
  const fetched = spawnSync('git', ['fetch', '-q'], { cwd: root, encoding: 'utf8', timeout: 10_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  const behind = fetched.status === 0 ? Number(spawnSync('git', ['rev-list', '--count', 'HEAD..@{u}'], { cwd: root, encoding: 'utf8' }).stdout.trim() || '0') : 0;
  if (fetched.status !== 0) console.log(`[dev] Sem acesso ao GitHub agora (${(fetched.stderr || fetched.error?.message || 'sem detalhe').trim().split('\n')[0]}); subindo com o código que já está aqui, que pode estar desatualizado (rode de novo quando a internet voltar).`);
  else if (behind > 0) {
    console.log(`[dev] Há ${behind} novidade(s) no GitHub: rodando o update antes de subir (pode levar alguns minutos)…`);
    const result = spawnSync(process.execPath, [join(root, 'scripts/update.mjs')], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) console.log('[dev] O update terminou com problemas (veja acima). Subindo mesmo assim; se algo quebrar, me mande o relatório.');
  } else console.log('[dev] Código já está atualizado.');
}
if (process.argv.includes('--update')) {
  const { ensureSetup } = await import('./ensure-setup.mjs');
  ensureSetup();
}
freePort(3000);
freePort(5173);
freePort(5174);
await sleep(500);

console.log(`[dev] API → http://localhost:3000   (log em ${logPath})`);
children.push(start('api', join(root, 'apps/api'), 'npm', ['run', 'dev'], {}, logPath));
await sleep(2500);
console.log(`[dev] Web → ${useHttps ? 'https' : 'http'}://localhost:5173${useHttps ? '   (celular: https://IP-DO-MAC:5173)' : ''}`);
children.push(start('web', join(root, 'apps/web'), 'npm', ['run', useHttps ? 'dev:https' : 'dev'], {}));
console.log('[dev] Gestão (só computador) → http://localhost:5174   (criar admin: cd apps/api && npm run admin:promote -- seu@email.com)');
children.push(start('gestao', join(root, 'apps/admin'), 'npm', ['run', 'dev'], {}));
console.log('[dev] Tudo no ar. Ctrl+C para encerrar.');
