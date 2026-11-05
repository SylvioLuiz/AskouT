-- NOW: quem convida e quem aceita escolhe se o outro vê a posição exata ou só aproximada (~1 km).
ALTER TABLE "FlashInvite" ADD COLUMN "fromApprox" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FlashInvite" ADD COLUMN "toApprox" BOOLEAN NOT NULL DEFAULT false;
