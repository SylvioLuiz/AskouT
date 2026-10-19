-- Denúncia de story: uma por pessoa; quem denunciou deixa de ver o story.
CREATE TABLE "EventStoryReport" (
    "id" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStoryReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventStoryReport_storyId_reporterId_key" ON "EventStoryReport"("storyId", "reporterId");
CREATE INDEX "EventStoryReport_reporterId_idx" ON "EventStoryReport"("reporterId");

ALTER TABLE "EventStoryReport" ADD CONSTRAINT "EventStoryReport_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "EventStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventStoryReport" ADD CONSTRAINT "EventStoryReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
