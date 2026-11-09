// Empacota o app web (apps/web) dentro da casca: gera `www/` com o site já apontando para a API de produção
// e injeta as pontes nativas (src/main.ts) antes do app.
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const mobile = join(here, '..');
const web = join(mobile, '..', 'web');
const www = join(mobile, 'www');

const apiUrl = process.env.VITE_API_URL;
if (!apiUrl || !/^https:\/\//.test(apiUrl)) {
  console.error('Defina VITE_API_URL com o endereço https da API (ex.: VITE_API_URL=https://api.seudominio.com.br).');
  process.exit(1);
}

function run(command, args, cwd, env = {}) {
  // No Windows o `npx` é um .cmd: sem `shell` o spawn falha com ENOENT (e, nas versões recentes do Node, com EINVAL).
  // Os argumentos aqui são fixos e sem espaços, então o shell não muda nada além de achar o executável.
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npx', ['vite', 'build', '--outDir', www, '--emptyOutDir'], web, { VITE_API_URL: apiUrl.replace(/\/+$/, '') });
// Imagens da ficha das lojas (public/loja) servem só ao site: não entram no app.
rmSync(join(www, 'loja'), { recursive: true, force: true });
run('npx', ['esbuild', 'src/main.ts', '--bundle', '--format=esm', '--minify', '--target=es2022', `--outfile=${join(www, 'native-bridge.js')}`], mobile);

const indexPath = join(www, 'index.html');
const html = readFileSync(indexPath, 'utf8');
if (!html.includes('<head>')) {
  console.error('index.html sem <head>: não foi possível injetar as pontes nativas.');
  process.exit(1);
}
// Primeiro script do <head>: scripts de módulo rodam na ordem em que aparecem.
writeFileSync(indexPath, html.replace('<head>', '<head>\n    <script type="module" src="/native-bridge.js"></script>'));
console.log('Pronto: www/ gerado. Rode `npm run sync` (ou `npx cap sync`) para copiar para iOS e Android.');
