-- Perfil compartilhado na conversa: a mensagem mostra o cartão do perfil (sem chave estrangeira: se a conta sumir, o cartão vira "Perfil indisponível").
ALTER TABLE "Message" ADD COLUMN "profileUserId" UUID;
