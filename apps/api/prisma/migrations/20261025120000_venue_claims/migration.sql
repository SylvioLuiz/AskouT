-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN "ownerId" UUID;

-- CreateTable
CREATE TABLE "VenueClaim" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "documentMime" TEXT NOT NULL,
    "document" BYTEA NOT NULL,
    "reviewNote" TEXT,
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Venue_ownerId_idx" ON "Venue"("ownerId");
CREATE INDEX "VenueClaim_userId_createdAt_idx" ON "VenueClaim"("userId", "createdAt");
CREATE INDEX "VenueClaim_venueId_status_idx" ON "VenueClaim"("venueId", "status");
CREATE INDEX "VenueClaim_status_createdAt_idx" ON "VenueClaim"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VenueClaim" ADD CONSTRAINT "VenueClaim_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueClaim" ADD CONSTRAINT "VenueClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueClaim" ADD CONSTRAINT "VenueClaim_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
