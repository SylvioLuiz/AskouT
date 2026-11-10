-- Consentimentos opcionais (novidades por e-mail e push) e o "sim" opcional no cadastro.

-- AlterTable
ALTER TABLE "PendingSignup" ADD COLUMN "marketingEmail" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConsentEvent" (
    "id" UUID NOT NULL,
    "seq" SERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConsentEvent_userId_at_idx" ON "ConsentEvent"("userId", "at");

-- AddForeignKey
ALTER TABLE "ConsentEvent" ADD CONSTRAINT "ConsentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
