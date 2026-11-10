-- Álbum do encontro: fotos só de quem foi ao encontro do NOW ou ao evento, e aviso do dia seguinte.

-- CreateTable
CREATE TABLE "Album" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "title" TEXT,
    "placeName" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Album_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AlbumMember" (
    "albumId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summarizedAt" TIMESTAMP(3),

    CONSTRAINT "AlbumMember_pkey" PRIMARY KEY ("albumId","userId")
);

CREATE TABLE "AlbumPhoto" (
    "id" UUID NOT NULL,
    "albumId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlbumPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Album_kind_refId_key" ON "Album"("kind", "refId");
CREATE INDEX "Album_startedAt_idx" ON "Album"("startedAt");
CREATE INDEX "AlbumMember_userId_idx" ON "AlbumMember"("userId");
CREATE INDEX "AlbumPhoto_albumId_createdAt_idx" ON "AlbumPhoto"("albumId", "createdAt");
CREATE INDEX "AlbumPhoto_authorId_idx" ON "AlbumPhoto"("authorId");

-- AddForeignKey
ALTER TABLE "AlbumMember" ADD CONSTRAINT "AlbumMember_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlbumMember" ADD CONSTRAINT "AlbumMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlbumPhoto" ADD CONSTRAINT "AlbumPhoto_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AlbumPhoto" ADD CONSTRAINT "AlbumPhoto_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
