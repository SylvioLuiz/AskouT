-- O app do aparelho mostra "Responder" na notificação de mensagem.
ALTER TABLE "PushSubscription" ADD COLUMN "replyable" BOOLEAN NOT NULL DEFAULT false;
