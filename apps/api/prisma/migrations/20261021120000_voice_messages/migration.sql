-- AlterEnum
ALTER TYPE "MessageKind" ADD VALUE 'AUDIO';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "audioMs" INTEGER;

-- CreateTable
CREATE TABLE "MessageAudio" (
    "messageId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "MessageAudio_pkey" PRIMARY KEY ("messageId")
);

-- AddForeignKey
ALTER TABLE "MessageAudio" ADD CONSTRAINT "MessageAudio_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
