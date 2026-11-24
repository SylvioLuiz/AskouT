-- Pedido de cadastro do celular ao abrir o app: quantas vezes já apareceu e quando foi a última (vale entre aparelhos).
ALTER TABLE "UserSettings" ADD COLUMN "phonePromptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "UserSettings" ADD COLUMN "phonePromptAt" TIMESTAMP(3);
