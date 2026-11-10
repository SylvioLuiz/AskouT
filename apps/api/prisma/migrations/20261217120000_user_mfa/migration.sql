-- Verificação em duas etapas por app autenticador (TOTP), opcional por conta.

-- CreateTable
CREATE TABLE "UserMfa" (
    "userId" UUID NOT NULL,
    "secretSealed" TEXT NOT NULL,
    "enabledAt" TIMESTAMP(3),
    "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedStep" INTEGER NOT NULL DEFAULT -1,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMfa_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "UserMfa" ADD CONSTRAINT "UserMfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
