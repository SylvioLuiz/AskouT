-- Post de foto, vídeo ou só texto vinculado a um evento (de um local ou criado por alguém). Sem chave estrangeira: o id pode ser de PlaceEvent ou de Post (evento de pessoa).
ALTER TABLE "Post" ADD COLUMN "linkedEventId" UUID;
CREATE INDEX "Post_linkedEventId_createdAt_idx" ON "Post"("linkedEventId", "createdAt");
