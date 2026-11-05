-- Tutorial inicial passa a ser lembrado por conta (antes só no navegador).
-- Quem já tem conta já passou pelo primeiro login: não vê o tutorial de novo.
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);
UPDATE "User" SET "onboardedAt" = "createdAt";
