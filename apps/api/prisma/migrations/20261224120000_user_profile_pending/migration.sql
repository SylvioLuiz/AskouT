-- Conta nova pelo Google/Apple é criada já no login e fica pendente até a pessoa escolher o nome de usuário e informar a data de nascimento.
-- Quem já tem conta já concluiu o cadastro.
ALTER TABLE "User" ADD COLUMN "profilePending" BOOLEAN NOT NULL DEFAULT false;
-- Conta criada pelo Google/Apple sem senha definida (para não deixar desligar a última forma de entrar).
ALTER TABLE "User" ADD COLUMN "passwordless" BOOLEAN NOT NULL DEFAULT false;
-- Até aqui o app tratava como "sem senha" toda conta com Google/Apple ligado; mantém igual para as contas que já existem.
UPDATE "User" SET "passwordless" = true WHERE id IN (SELECT "userId" FROM "ExternalIdentity");
