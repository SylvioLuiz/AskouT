-- CreateTable
CREATE TABLE "FlashAsk" (
    "askerId" UUID NOT NULL,
    "targetId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlashAsk_pkey" PRIMARY KEY ("askerId","targetId")
);

-- CreateIndex
CREATE INDEX "FlashAsk_targetId_idx" ON "FlashAsk"("targetId");

-- AddForeignKey
ALTER TABLE "FlashAsk" ADD CONSTRAINT "FlashAsk_askerId_fkey" FOREIGN KEY ("askerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashAsk" ADD CONSTRAINT "FlashAsk_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
