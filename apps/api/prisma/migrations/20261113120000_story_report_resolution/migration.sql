-- Decisão da gestão sobre a denúncia de story (igual à de posts).
ALTER TABLE "EventStoryReport" ADD COLUMN "resolvedAt" TIMESTAMP(3),
ADD COLUMN "resolvedBy" UUID,
ADD COLUMN "resolution" TEXT,
ADD COLUMN "resolutionNote" TEXT;

CREATE INDEX "EventStoryReport_resolvedAt_idx" ON "EventStoryReport"("resolvedAt");
