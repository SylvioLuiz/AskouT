-- Ponte com o AskouT Hunter (sistema separado): liga cada evento cadastrado por ele à referência dele.
CREATE TABLE "HunterEventLink" (
    "ref" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HunterEventLink_pkey" PRIMARY KEY ("ref")
);
CREATE UNIQUE INDEX "HunterEventLink_eventId_key" ON "HunterEventLink"("eventId");
CREATE INDEX "HunterEventLink_createdAt_idx" ON "HunterEventLink"("createdAt");
CREATE INDEX "HunterEventLink_venueId_idx" ON "HunterEventLink"("venueId");
ALTER TABLE "HunterEventLink" ADD CONSTRAINT "HunterEventLink_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
