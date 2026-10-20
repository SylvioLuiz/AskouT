-- CreateTable
CREATE TABLE "ContentDwell" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "ms" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "clicked" BOOLEAN NOT NULL DEFAULT false,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDwell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentDwell_userId_createdAt_idx" ON "ContentDwell"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ContentDwell_createdAt_idx" ON "ContentDwell"("createdAt");

-- AddForeignKey
ALTER TABLE "ContentDwell" ADD CONSTRAINT "ContentDwell_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
