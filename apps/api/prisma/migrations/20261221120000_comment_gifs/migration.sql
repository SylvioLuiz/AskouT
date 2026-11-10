-- GIFs (Giphy) nos comentários de post e nos comentários do feed de evento e rolê.
-- Guarda só o id e o endereço do GIF; o texto do comentário pode ficar vazio quando há GIF.

-- AlterTable
ALTER TABLE "PostComment" ADD COLUMN "gifId" TEXT,
ADD COLUMN "gifUrl" TEXT;

-- AlterTable
ALTER TABLE "FeedComment" ADD COLUMN "gifId" TEXT,
ADD COLUMN "gifUrl" TEXT;
