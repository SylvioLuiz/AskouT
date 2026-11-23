-- Solicitações de mensagens: conversa 1 a 1 começada por quem a pessoa não segue fica pendente até ela aceitar.
ALTER TABLE "Conversation" ADD COLUMN "requestToId" UUID;
ALTER TABLE "Conversation" ADD COLUMN "requestDeclinedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "acceptedAt" TIMESTAMP(3);

-- Perfil público pode receber mensagens de qualquer pessoa direto na caixa de conversas.
ALTER TABLE "UserSettings" ADD COLUMN "openDms" BOOLEAN NOT NULL DEFAULT false;
