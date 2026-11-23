-- Mensagem pela página do local: conversa 1 a 1 entre quem escreveu e o dono, marcada com o local.
ALTER TABLE "Conversation" ADD COLUMN "venueId" UUID;

CREATE INDEX "Conversation_venueId_idx" ON "Conversation"("venueId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
