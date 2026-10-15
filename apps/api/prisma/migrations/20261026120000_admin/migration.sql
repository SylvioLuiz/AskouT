-- AlterTable
ALTER TABLE "PostReport" ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolvedBy" UUID,
ADD COLUMN "resolution" TEXT,
ADD COLUMN "resolutionNote" TEXT;

-- AlterTable
ALTER TABLE "ConversationReport" ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolvedBy" UUID,
ADD COLUMN "resolution" TEXT,
ADD COLUMN "resolutionNote" TEXT;

-- CreateTable
CREATE TABLE "AdminAudit" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
CREATE INDEX "PostReport_resolvedAt_idx" ON "PostReport"("resolvedAt");
CREATE INDEX "ConversationReport_resolvedAt_idx" ON "ConversationReport"("resolvedAt");
