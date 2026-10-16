-- Responder, apagar para todos, reações, foto/vídeo, fixar e silenciar.
ALTER TABLE "Message" ADD COLUMN "replyToId" UUID;
ALTER TABLE "Message" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");

ALTER TABLE "ConversationParticipant" ADD COLUMN "pinnedAt" TIMESTAMP(3);
ALTER TABLE "ConversationParticipant" ADD COLUMN "muted" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MessageMedia" (
    "messageId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    CONSTRAINT "MessageMedia_pkey" PRIMARY KEY ("messageId")
);
ALTER TABLE "MessageMedia" ADD CONSTRAINT "MessageMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MessageReaction" (
    "messageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId","userId")
);
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
