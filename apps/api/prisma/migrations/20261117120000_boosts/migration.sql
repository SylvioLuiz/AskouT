-- CreateTable
CREATE TABLE "Boost" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "eventId" UUID,
    "days" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "chargeId" TEXT,
    "payCode" TEXT,
    "payUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "Boost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Boost_chargeId_key" ON "Boost"("chargeId");

-- CreateIndex
CREATE INDEX "Boost_venueId_createdAt_idx" ON "Boost"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "Boost_status_startsAt_endsAt_idx" ON "Boost"("status", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "Boost" ADD CONSTRAINT "Boost_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Boost" ADD CONSTRAINT "Boost_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
