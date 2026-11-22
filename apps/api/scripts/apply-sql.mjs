// Aplica, em ordem, as restrições e ajustes de `apps/api/prisma/sql/*.sql` no banco do DATABASE_URL.
// Roda a cada deploy, depois do `prisma migrate deploy` (ver o Dockerfile). Todos os arquivos podem ser rodados de novo
// sem erro; um que falhe é registrado no log e os seguintes continuam (a API sobe do mesmo jeito).
// Uso: node apps/api/scripts/apply-sql.mjs   (SQL_APPLY=off desliga)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.SQL_APPLY === 'off') {
  console.log('[sql] SQL_APPLY=off: nada aplicado.');
  process.exit(0);
}
const api = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(api, 'prisma/sql');
const schema = join(api, 'prisma/schema.prisma');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let failed = 0;
for (const file of files) {
  const run = spawnSync('npx', ['prisma', 'db', 'execute', '--file', join(dir, file), '--schema', schema], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (run.status === 0) {
    console.log(`[sql] ok: ${file}`);
  } else {
    failed += 1;
    console.error(`[sql] FALHOU: ${file}\n${(run.stderr || run.stdout || '').trim().slice(0, 1500)}`);
  }
}
console.log(`[sql] ${files.length - failed} de ${files.length} arquivos aplicados${failed ? `, ${failed} com erro` : ''}.`);
