-- Curtidas (coração) nos stories, como no Instagram.

-- CreateTable
CREATE TABLE "EventStoryLike" (
    "storyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventStoryLike_pkey" PRIMARY KEY ("storyId","userId")
);

-- CreateIndex
CREATE INDEX "EventStoryLike_userId_idx" ON "EventStoryLike"("userId");

-- AddForeignKey
ALTER TABLE "EventStoryLike" ADD CONSTRAINT "EventStoryLike_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "EventStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventStoryLike" ADD CONSTRAINT "EventStoryLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
