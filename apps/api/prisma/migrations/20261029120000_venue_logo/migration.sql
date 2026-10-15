-- Logo do estabelecimento (círculo da página).
ALTER TABLE "Venue" ADD COLUMN "logoUrl" TEXT;

CREATE TABLE "VenueLogo" (
    "venueId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VenueLogo_pkey" PRIMARY KEY ("venueId")
);
ALTER TABLE "VenueLogo" ADD CONSTRAINT "VenueLogo_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
