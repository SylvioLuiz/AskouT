-- Login pelo celular com código por SMS: celular confirmado e o código em andamento.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PhoneCode" (
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendCount" INTEGER NOT NULL DEFAULT 1,
    "lastSentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneCode_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "PhoneCode" ADD CONSTRAINT "PhoneCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
