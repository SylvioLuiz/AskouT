// Cria (ou reaproveita) um local de TESTE e o entrega à conta de demonstração da App Review da Apple,
// para o revisor conseguir chegar à tela de Impulsionar (compra dentro do app).
//
//   npm run seed:review-venue                       (conta: apple-review@askout.com.br)
//   npm run seed:review-venue -- --email outra@x.y  (outra conta)
//
// Seguro para rodar mais de uma vez. Não apaga nada. Usa DATABASE_URL do ambiente (Shell do Render).
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const i = process.argv.indexOf('--email');
const email = (i >= 0 ? process.argv[i + 1] : undefined) ?? 'apple-review@askout.com.br';
const NAME = '[TESTE] Bar do Revisor';

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Conta ${email} não encontrada. Crie/entre nela uma vez e rode de novo.`);
  const existing = await prisma.venue.findFirst({ where: { name: NAME, isSample: true } });
  if (existing) {
    await prisma.venue.update({ where: { id: existing.id }, data: { ownerId: user.id } });
    console.log(`Local já existia (${existing.id}); responsável atualizado para ${email}.`);
  } else {
    const id = randomUUID();
    await prisma.venue.create({
      data: {
        id,
        name: NAME,
        address: 'Av. Paulista, 1000 - São Paulo (exemplo)',
        category: 'bar',
        lat: -23.5614,
        lng: -46.6559,
        isSample: true,
        ownerId: user.id,
        description: 'Local de exemplo criado para a revisão da Apple. Dados de teste.',
      },
    });
    console.log(`Local criado (${id}) e entregue a ${email}.`);
  }
} finally {
  await prisma.$disconnect();
}
