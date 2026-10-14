-- CreateTable
CREATE TABLE "FlashHidden" (
    "ownerId" UUID NOT NULL,
    "otherId" UUID NOT NULL,
    "hideTheirs" BOOLEAN NOT NULL DEFAULT false,
    "hideMine" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlashHidden_pkey" PRIMARY KEY ("ownerId","otherId")
);

-- CreateIndex
CREATE INDEX "FlashHidden_otherId_idx" ON "FlashHidden"("otherId");

-- AddForeignKey
ALTER TABLE "FlashHidden" ADD CONSTRAINT "FlashHidden_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashHidden" ADD CONSTRAINT "FlashHidden_otherId_fkey" FOREIGN KEY ("otherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
