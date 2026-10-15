// Dá (ou tira) o acesso de administrador a uma conta, para entrar na plataforma de gestão.
//
//   npm run admin:promote -- voce@exemplo.com            (vira administrador)
//   npm run admin:promote -- voce@exemplo.com --remove   (volta a ser conta comum)
//   npm run admin:promote -- --list                      (lista os administradores)
//
// A conta precisa existir (cadastre-se no app antes). Não há outro jeito de criar administradores: é de propósito.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const here = dirname(fileURLToPath(import.meta.url));

function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = join(here, '..', '.env');
  if (existsSync(envFile)) {
    const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  throw new Error('DATABASE_URL não encontrada (variável de ambiente ou apps/api/.env)');
}

const prisma = new PrismaClient({ datasourceUrl: databaseUrl() });
try {
  if (process.argv.includes('--list')) {
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' }, select: { email: true, profile: { select: { username: true } } }, orderBy: { createdAt: 'asc' } });
    console.log(admins.length === 0 ? 'Nenhum administrador ainda.' : admins.map((a) => `${a.email} (@${a.profile?.username ?? '?'})`).join('\n'));
  } else {
    const email = process.argv.slice(2).find((a) => !a.startsWith('--'))?.trim().toLowerCase();
    if (!email) throw new Error('Informe o e-mail da conta. Ex.: npm run admin:promote -- voce@exemplo.com');
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true, status: true } });
    if (!user) throw new Error(`Não achei conta com o e-mail ${email}. Cadastre-se no app primeiro.`);
    const remove = process.argv.includes('--remove');
    if (!remove && user.status !== 'ACTIVE') throw new Error('A conta não está ativa; reative antes de torná-la administradora.');
    await prisma.user.update({ where: { id: user.id }, data: { role: remove ? 'USER' : 'ADMIN' } });
    console.log(remove ? `${email} voltou a ser conta comum.` : `${email} agora é administradora. Entre em http://localhost:5174 com o mesmo e-mail e senha.`);
  }
} finally {
  await prisma.$disconnect();
}
