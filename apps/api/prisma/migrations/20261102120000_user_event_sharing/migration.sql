-- Eventos criados por pessoas: privado, compartilhado em conversa e repostado no perfil.
ALTER TABLE "Post" ADD COLUMN "eventPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Message" ADD COLUMN "postEventId" UUID;
CREATE INDEX "Message_postEventId_idx" ON "Message"("postEventId");
ALTER TABLE "Message" ADD CONSTRAINT "Message_postEventId_fkey" FOREIGN KEY ("postEventId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PostedUserEvent" (
    "userId" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostedUserEvent_pkey" PRIMARY KEY ("userId","postId")
);
CREATE INDEX "PostedUserEvent_userId_createdAt_idx" ON "PostedUserEvent"("userId", "createdAt");
ALTER TABLE "PostedUserEvent" ADD CONSTRAINT "PostedUserEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostedUserEvent" ADD CONSTRAINT "PostedUserEvent_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
