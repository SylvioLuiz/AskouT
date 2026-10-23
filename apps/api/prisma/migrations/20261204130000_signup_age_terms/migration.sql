-- Cadastros pendentes antigos não têm data de nascimento nem aceite: quem estava no meio refaz o cadastro (o código vale poucos minutos).
DELETE FROM "PendingSignup";
ALTER TABLE "PendingSignup" ADD COLUMN "birthDate" DATE NOT NULL, ADD COLUMN "termsVersion" TEXT NOT NULL;
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3), ADD COLUMN "termsVersion" TEXT;
