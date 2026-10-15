-- Perfil do estabelecimento: descrição, horários, capa, origem externa, seguidores e posts em nome do local.
ALTER TABLE "Venue" ADD COLUMN "description" TEXT;
ALTER TABLE "Venue" ADD COLUMN "hoursJson" TEXT;
ALTER TABLE "Venue" ADD COLUMN "coverUrl" TEXT;
ALTER TABLE "Venue" ADD COLUMN "externalKey" TEXT;
ALTER TABLE "Venue" ADD COLUMN "photoRef" TEXT;
ALTER TABLE "Venue" ADD COLUMN "photoAuthor" TEXT;
CREATE UNIQUE INDEX "Venue_externalKey_key" ON "Venue"("externalKey");

ALTER TABLE "Post" ADD COLUMN "venueId" UUID;
CREATE INDEX "Post_venueId_createdAt_idx" ON "Post"("venueId", "createdAt");
ALTER TABLE "Post" ADD CONSTRAINT "Post_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VenueCover" (
    "venueId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VenueCover_pkey" PRIMARY KEY ("venueId")
);
ALTER TABLE "VenueCover" ADD CONSTRAINT "VenueCover_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VenueFollow" (
    "userId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VenueFollow_pkey" PRIMARY KEY ("userId", "venueId")
);
CREATE INDEX "VenueFollow_venueId_idx" ON "VenueFollow"("venueId");
ALTER TABLE "VenueFollow" ADD CONSTRAINT "VenueFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueFollow" ADD CONSTRAINT "VenueFollow_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
