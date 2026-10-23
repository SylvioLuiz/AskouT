-- No máximo uma proposta aberta por votação. O código já conta com isso (erro P2002 vira CONFLICT),
-- mas o índice nunca tinha sido criado. Índice parcial: o Prisma não consegue descrevê-lo no schema.
CREATE UNIQUE INDEX "DatePollProposal_pollId_open_key" ON "DatePollProposal"("pollId") WHERE "status" = 'OPEN';
