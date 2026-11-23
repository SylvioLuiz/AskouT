-- Grupo do evento: o grupo guarda o evento (post) para o qual foi criado.
ALTER TABLE "Group" ADD COLUMN "eventPostId" UUID;

CREATE INDEX "Group_eventPostId_idx" ON "Group"("eventPostId");

ALTER TABLE "Group" ADD CONSTRAINT "Group_eventPostId_fkey" FOREIGN KEY ("eventPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Grupos já abertos pela votação da data de um evento passam a ser o grupo desse evento.
UPDATE "Group" g SET "eventPostId" = d."eventPostId"
FROM "Conversation" c JOIN "DatePoll" d ON d."conversationId" = c."id"
WHERE c."groupId" = g."id" AND d."eventPostId" IS NOT NULL AND d."status" <> 'CANCELLED' AND g."eventPostId" IS NULL;
