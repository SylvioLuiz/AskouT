-- AlterTable
ALTER TABLE "ConversationParticipant" ADD COLUMN "clearedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConversationReport" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reportedUserId" UUID,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "evidence" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConversationReport_conversationId_reporterId_key" ON "ConversationReport"("conversationId", "reporterId");

-- CreateIndex
CREATE INDEX "ConversationReport_createdAt_idx" ON "ConversationReport"("createdAt");

-- AddForeignKey
ALTER TABLE "ConversationReport" ADD CONSTRAINT "ConversationReport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReport" ADD CONSTRAINT "ConversationReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationReport" ADD CONSTRAINT "ConversationReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
