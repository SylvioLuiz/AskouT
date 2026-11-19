-- CreateTable
CREATE TABLE "VenueOffer" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "VenueOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueOffer_venueId_createdAt_idx" ON "VenueOffer"("venueId", "createdAt");

-- CreateIndex
CREATE INDEX "VenueOffer_endsAt_idx" ON "VenueOffer"("endsAt");

-- Uma oferta no ar por local, mesmo com publicações ao mesmo tempo (o Prisma não modela índice parcial).
CREATE UNIQUE INDEX "VenueOffer_one_open_per_venue" ON "VenueOffer"("venueId") WHERE "endedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "VenueOffer" ADD CONSTRAINT "VenueOffer_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueOffer" ADD CONSTRAINT "VenueOffer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
