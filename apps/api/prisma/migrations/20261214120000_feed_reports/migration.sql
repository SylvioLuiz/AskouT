-- Denúncias de publicações e comentários do feed dos eventos e rolês.

-- CreateTable
CREATE TABLE "FeedReport" (
    "id" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "postId" UUID NOT NULL,
    "commentId" UUID,
    "reporterId" UUID NOT NULL,
    "reportedUserId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "evidence" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" UUID,
    "resolution" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "FeedReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedReport_dedupeKey_key" ON "FeedReport"("dedupeKey");
CREATE INDEX "FeedReport_createdAt_idx" ON "FeedReport"("createdAt");
CREATE INDEX "FeedReport_resolvedAt_idx" ON "FeedReport"("resolvedAt");
CREATE INDEX "FeedReport_reporterId_idx" ON "FeedReport"("reporterId");
CREATE INDEX "FeedReport_postId_idx" ON "FeedReport"("postId");
CREATE INDEX "FeedReport_commentId_idx" ON "FeedReport"("commentId");

-- AddForeignKey
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "FeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedReport" ADD CONSTRAINT "FeedReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
