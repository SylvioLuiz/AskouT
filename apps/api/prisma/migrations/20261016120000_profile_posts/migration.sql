-- AlterEnum
ALTER TYPE "MessageKind" ADD VALUE 'EVENT';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "eventId" UUID;

-- CreateTable
CREATE TABLE "ProfilePhoto" (
    "userId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PostedEvent" (
    "userId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostedEvent_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateIndex
CREATE INDEX "PostedEvent_userId_createdAt_idx" ON "PostedEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_eventId_idx" ON "Message"("eventId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostedEvent" ADD CONSTRAINT "PostedEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostedEvent" ADD CONSTRAINT "PostedEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
