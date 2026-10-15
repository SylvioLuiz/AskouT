-- CreateTable
CREATE TABLE "PlaceEventCover" (
    "eventId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceEventCover_pkey" PRIMARY KEY ("eventId")
);

-- AddForeignKey
ALTER TABLE "PlaceEventCover" ADD CONSTRAINT "PlaceEventCover_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
