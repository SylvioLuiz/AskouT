-- Visualizações dos stories (só quem publicou vê a contagem).

-- CreateTable
CREATE TABLE "EventStoryView" (
    "storyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStoryView_pkey" PRIMARY KEY ("storyId","userId")
);

-- CreateIndex
CREATE INDEX "EventStoryView_userId_idx" ON "EventStoryView"("userId");

-- AddForeignKey
ALTER TABLE "EventStoryView" ADD CONSTRAINT "EventStoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "EventStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStoryView" ADD CONSTRAINT "EventStoryView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
