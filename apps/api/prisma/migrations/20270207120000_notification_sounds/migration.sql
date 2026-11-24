-- Som do push escolhido pela pessoa para cada grupo de aviso (padrão do aparelho, sem som ou um som do AskouT).
ALTER TABLE "NotificationSetting" ADD COLUMN "soundChats" TEXT NOT NULL DEFAULT 'padrao';
ALTER TABLE "NotificationSetting" ADD COLUMN "soundInvites" TEXT NOT NULL DEFAULT 'padrao';
ALTER TABLE "NotificationSetting" ADD COLUMN "soundArrival" TEXT NOT NULL DEFAULT 'padrao';
ALTER TABLE "NotificationSetting" ADD COLUMN "soundOther" TEXT NOT NULL DEFAULT 'padrao';

-- O app do aparelho tem os sons do AskouT (versões antigas recebem só o som padrão).
ALTER TABLE "PushSubscription" ADD COLUMN "sounds" BOOLEAN NOT NULL DEFAULT false;
