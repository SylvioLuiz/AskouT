-- Aplicar depois da migration do Flash (prisma migrate dev --name flash) e do 001.

-- Uma sessão de Flash em aberto (não desligada) por pessoa. A API fecha as já vencidas antes de criar outra.
CREATE UNIQUE INDEX flash_one_open_session ON "FlashSession" ("userId") WHERE "endedAt" IS NULL;

-- Convite coerente: ninguém convida a si mesmo.
ALTER TABLE "FlashInvite" ADD CONSTRAINT flash_invite_no_self CHECK ("fromUserId" <> "toUserId");

-- Só um convite aberto (pendente ou aceito) por par de pessoas, em qualquer sentido. A API fecha os vencidos antes.
CREATE UNIQUE INDEX flash_one_open_invite_per_pair ON "FlashInvite" (
  LEAST("fromUserId", "toUserId"),
  GREATEST("fromUserId", "toUserId")
) WHERE status IN ('PENDING', 'ACCEPTED');

-- Coordenadas válidas.
ALTER TABLE "FlashPosition" ADD CONSTRAINT flash_position_lat CHECK (lat BETWEEN -90 AND 90);
ALTER TABLE "FlashPosition" ADD CONSTRAINT flash_position_lng CHECK (lng BETWEEN -180 AND 180);
