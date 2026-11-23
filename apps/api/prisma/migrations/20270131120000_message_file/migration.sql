-- Documento na conversa (PDF, Word, Excel...): o nome fica no body e os bytes em MessageMedia.
ALTER TYPE "MessageKind" ADD VALUE IF NOT EXISTS 'FILE';
