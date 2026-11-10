-- Check-in no local por QR code: código secreto do local (trocável) e os check-ins.
CREATE TABLE "VenueCheckinCode" (
    "venueId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VenueCheckinCode_pkey" PRIMARY KEY ("venueId")
);
CREATE TABLE "VenueCheckin" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VenueCheckin_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VenueCheckin_venueId_userId_createdAt_idx" ON "VenueCheckin"("venueId", "userId", "createdAt");
ALTER TABLE "VenueCheckinCode" ADD CONSTRAINT "VenueCheckinCode_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueCheckin" ADD CONSTRAINT "VenueCheckin_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueCheckin" ADD CONSTRAINT "VenueCheckin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
