-- Organizações (bateria, atlética...) usam a mesma página dos locais; o sininho de quem segue avisa de cada evento novo.
ALTER TABLE "Venue" ADD COLUMN "isOrganization" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "VenueFollow" ADD COLUMN "notify" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "VenueFollow_venueId_notify_idx" ON "VenueFollow"("venueId", "notify");
