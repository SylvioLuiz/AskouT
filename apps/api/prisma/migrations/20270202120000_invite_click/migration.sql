-- Convite que sobrevive à instalação: toque no link de convite guardado pela rede (hash), apagado depois de poucos dias.

-- CreateTable
CREATE TABLE "InviteClick" (
    "id" UUID NOT NULL,
    "networkKey" TEXT NOT NULL,
    "inviterId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InviteClick_networkKey_createdAt_idx" ON "InviteClick"("networkKey", "createdAt");

-- CreateIndex
CREATE INDEX "InviteClick_createdAt_idx" ON "InviteClick"("createdAt");
