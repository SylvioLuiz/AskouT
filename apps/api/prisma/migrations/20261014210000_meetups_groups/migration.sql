-- AlterEnum
ALTER TYPE "MessageKind" ADD VALUE 'MEETUP';

-- AlterTable
ALTER TABLE "Meeting" ADD COLUMN     "conversationId" UUID,
ADD COLUMN     "eventId" UUID;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "meetupId" UUID;

-- CreateIndex
CREATE INDEX "Meeting_eventId_idx" ON "Meeting"("eventId");

-- CreateIndex
CREATE INDEX "Meeting_conversationId_idx" ON "Meeting"("conversationId");

-- CreateIndex
CREATE INDEX "Message_meetupId_idx" ON "Message"("meetupId");

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PlaceEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_meetupId_fkey" FOREIGN KEY ("meetupId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
