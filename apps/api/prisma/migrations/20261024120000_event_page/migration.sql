-- AlterEnum
ALTER TYPE "EventKind" ADD VALUE 'OUTDOOR';
ALTER TYPE "EventKind" ADD VALUE 'SPORT';

-- AlterTable
ALTER TABLE "Post" ADD COLUMN "eventKind" "EventKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN "eventPostsPublic" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EventAttendance" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "placeEventId" UUID,
    "postId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventPost" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "caption" TEXT NOT NULL,
    "mime" TEXT,
    "data" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventAttendance_userId_placeEventId_key" ON "EventAttendance"("userId", "placeEventId");
CREATE UNIQUE INDEX "EventAttendance_userId_postId_key" ON "EventAttendance"("userId", "postId");
CREATE INDEX "EventAttendance_placeEventId_createdAt_idx" ON "EventAttendance"("placeEventId", "createdAt");
CREATE INDEX "EventAttendance_postId_createdAt_idx" ON "EventAttendance"("postId", "createdAt");
CREATE INDEX "EventPost_eventId_createdAt_idx" ON "EventPost"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_placeEventId_fkey" FOREIGN KEY ("placeEventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventAttendance" ADD CONSTRAINT "EventAttendance_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPost" ADD CONSTRAINT "EventPost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventPost" ADD CONSTRAINT "EventPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
