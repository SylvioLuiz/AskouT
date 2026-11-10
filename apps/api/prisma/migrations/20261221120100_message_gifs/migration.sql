-- GIFs (Giphy) nas mensagens do chat (mensagem de texto com body "GIF").

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "gifId" TEXT,
ADD COLUMN "gifUrl" TEXT;
