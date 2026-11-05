-- CreateTable
CREATE TABLE "StoryHidden" (
    "ownerId" UUID NOT NULL,
    "otherId" UUID NOT NULL,
    "hideTheirs" BOOLEAN NOT NULL DEFAULT false,
    "hideMine" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryHidden_pkey" PRIMARY KEY ("ownerId","otherId")
);

-- CreateIndex
CREATE INDEX "StoryHidden_otherId_idx" ON "StoryHidden"("otherId");

-- AddForeignKey
ALTER TABLE "StoryHidden" ADD CONSTRAINT "StoryHidden_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryHidden" ADD CONSTRAINT "StoryHidden_otherId_fkey" FOREIGN KEY ("otherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
