-- O encontro passa a guardar o ID do evento criado por uma pessoa (não só uma cópia do nome).
ALTER TABLE "Meeting" ADD COLUMN "eventPostId" UUID;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_eventPostId_fkey" FOREIGN KEY ("eventPostId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Meeting_eventPostId_idx" ON "Meeting"("eventPostId");

-- Encontros já fechados por votação ligada a um evento ganham o ID.
UPDATE "Meeting" m SET "eventPostId" = p."eventPostId"
FROM "DatePoll" p
WHERE p."meetupId" = m."id" AND p."eventPostId" IS NOT NULL;
