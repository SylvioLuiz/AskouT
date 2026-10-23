-- Denúncia de perfil e de comentário.
CREATE TABLE "UserReport" (
    "id" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reporterId" UUID NOT NULL,
    "reportedUserId" UUID NOT NULL,
    "commentId" TEXT,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "evidence" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" UUID,
    "resolution" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "UserReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserReport_dedupeKey_key" ON "UserReport"("dedupeKey");
CREATE INDEX "UserReport_createdAt_idx" ON "UserReport"("createdAt");
CREATE INDEX "UserReport_resolvedAt_idx" ON "UserReport"("resolvedAt");

ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserReport" ADD CONSTRAINT "UserReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
