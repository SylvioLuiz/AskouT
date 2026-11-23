-- NOW: cada um libera (ou não) o outro a acompanhar a chegada dele nas notificações do celular.
ALTER TABLE "FlashInvite" ADD COLUMN "fromArrival" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "FlashInvite" ADD COLUMN "toArrival" BOOLEAN NOT NULL DEFAULT false;
