-- Avaliação de 1 a 5 estrelas dos estabelecimentos.
CREATE TABLE "VenueRating" (
    "userId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VenueRating_pkey" PRIMARY KEY ("userId","venueId")
);
CREATE INDEX "VenueRating_venueId_idx" ON "VenueRating"("venueId");
ALTER TABLE "VenueRating" ADD CONSTRAINT "VenueRating_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueRating" ADD CONSTRAINT "VenueRating_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
