-- CreateEnum
CREATE TYPE "FlashInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED', 'ENDED');

-- AlterTable
ALTER TABLE "FlashSession" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "note" TEXT;

-- CreateTable
CREATE TABLE "FlashInvite" (
    "id" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "status" "FlashInviteStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "FlashInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlashPosition" (
    "inviteId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracyM" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashPosition_pkey" PRIMARY KEY ("inviteId","userId")
);

-- CreateIndex
CREATE INDEX "FlashInvite_fromUserId_status_idx" ON "FlashInvite"("fromUserId", "status");

-- CreateIndex
CREATE INDEX "FlashInvite_toUserId_status_idx" ON "FlashInvite"("toUserId", "status");

-- AddForeignKey
ALTER TABLE "FlashInvite" ADD CONSTRAINT "FlashInvite_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashInvite" ADD CONSTRAINT "FlashInvite_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashPosition" ADD CONSTRAINT "FlashPosition_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "FlashInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashPosition" ADD CONSTRAINT "FlashPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
