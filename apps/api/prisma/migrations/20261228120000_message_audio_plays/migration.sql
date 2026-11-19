-- "Ouvido" nas mensagens de voz: quem já tocou cada áudio.
CREATE TABLE "MessageAudioPlay" (
    "messageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "playedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAudioPlay_pkey" PRIMARY KEY ("messageId","userId")
);

ALTER TABLE "MessageAudioPlay" ADD CONSTRAINT "MessageAudioPlay_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageAudioPlay" ADD CONSTRAINT "MessageAudioPlay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
