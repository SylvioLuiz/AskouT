-- Respostas a comentários (posts e feed de evento e rolê): um nível só, sempre apontando para o comentário de cima.
-- Apagar o comentário de cima solta as respostas (ficam como comentários comuns).

-- AlterTable
ALTER TABLE "PostComment" ADD COLUMN "parentId" UUID;

-- AlterTable
ALTER TABLE "FeedComment" ADD COLUMN "parentId" UUID;

-- CreateIndex
CREATE INDEX "PostComment_parentId_idx" ON "PostComment"("parentId");

-- CreateIndex
CREATE INDEX "FeedComment_parentId_idx" ON "FeedComment"("parentId");

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PostComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FeedComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
