-- Story anexado à resposta/reação de story no chat.
ALTER TABLE "Message" ADD COLUMN "storyId" UUID;
