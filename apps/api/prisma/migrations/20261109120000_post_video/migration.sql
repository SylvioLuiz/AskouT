-- Vídeo no post: a capa continua em mime/data e o vídeo fica em colunas próprias.
ALTER TABLE "PostImage" ADD COLUMN "videoMime" TEXT;
ALTER TABLE "PostImage" ADD COLUMN "videoData" BYTEA;
