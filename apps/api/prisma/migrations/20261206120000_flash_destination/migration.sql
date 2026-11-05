-- Lugar que os dois escolhem no mapa do encontro Flash.
ALTER TABLE "FlashInvite" ADD COLUMN "destinationName" TEXT;
ALTER TABLE "FlashInvite" ADD COLUMN "destinationLat" DOUBLE PRECISION;
ALTER TABLE "FlashInvite" ADD COLUMN "destinationLng" DOUBLE PRECISION;
ALTER TABLE "FlashInvite" ADD COLUMN "destinationChosenBy" UUID;
ALTER TABLE "FlashInvite" ADD COLUMN "destinationChosenAt" TIMESTAMP(3);
