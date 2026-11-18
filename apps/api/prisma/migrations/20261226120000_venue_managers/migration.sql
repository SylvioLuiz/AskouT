-- Administradores adicionais do estabelecimento (convite do dono + aceite).
CREATE TYPE "VenueManagerStatus" AS ENUM ('PENDING', 'ACCEPTED');

CREATE TABLE "VenueManager" (
    "venueId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "VenueManagerStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "VenueManager_pkey" PRIMARY KEY ("venueId","userId")
);

CREATE INDEX "VenueManager_userId_status_idx" ON "VenueManager"("userId", "status");

ALTER TABLE "VenueManager" ADD CONSTRAINT "VenueManager_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueManager" ADD CONSTRAINT "VenueManager_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
