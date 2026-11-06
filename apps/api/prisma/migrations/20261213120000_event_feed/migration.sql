-- Feed dos eventos e dos rolês: publicações (fotos ou avisos), aprovação pelo dono, comentários com @menções e reações.
-- Substitui os posts antigos dentro do evento (EventPost), que são copiados para o feed antes de a tabela sair.

-- CreateEnum
CREATE TYPE "FeedPolicy" AS ENUM ('OPEN', 'MODERATED', 'OWNER_ONLY');

-- CreateEnum
CREATE TYPE "FeedPostKind" AS ENUM ('POST', 'NOTICE');

-- CreateEnum
CREATE TYPE "FeedPostStatus" AS ENUM ('PUBLISHED', 'PENDING');

-- Quem pode publicar: rolê, evento do local e evento criado por uma pessoa.
ALTER TABLE "Venue" ADD COLUMN "feedPolicy" "FeedPolicy" NOT NULL DEFAULT 'OWNER_ONLY';
ALTER TABLE "PlaceEvent" ADD COLUMN "feedPolicy" "FeedPolicy" NOT NULL DEFAULT 'OWNER_ONLY';
ALTER TABLE "Post" ADD COLUMN "feedPolicy" "FeedPolicy" NOT NULL DEFAULT 'OWNER_ONLY';
-- "Eu e quem vai" (publicação aberta) vira OPEN.
UPDATE "Post" SET "feedPolicy" = 'OPEN' WHERE "eventPostsPublic" = true;

-- CreateTable
CREATE TABLE "FeedPost" (
    "id" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "placeEventId" UUID,
    "userEventId" UUID,
    "venueId" UUID,
    "kind" "FeedPostKind" NOT NULL DEFAULT 'POST',
    "body" TEXT,
    "status" "FeedPostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "asVenue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "FeedPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedPostImage" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "mime" TEXT NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "FeedPostImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedReaction" (
    "postId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedReaction_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateTable
CREATE TABLE "FeedComment" (
    "id" UUID NOT NULL,
    "postId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedCommentReaction" (
    "commentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedCommentReaction_pkey" PRIMARY KEY ("commentId","userId")
);

-- CreateIndex
CREATE INDEX "FeedPost_placeEventId_status_createdAt_idx" ON "FeedPost"("placeEventId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPost_userEventId_status_createdAt_idx" ON "FeedPost"("userEventId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPost_venueId_status_createdAt_idx" ON "FeedPost"("venueId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "FeedPost_authorId_idx" ON "FeedPost"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedPostImage_postId_position_key" ON "FeedPostImage"("postId", "position");

-- CreateIndex
CREATE INDEX "FeedReaction_userId_idx" ON "FeedReaction"("userId");

-- CreateIndex
CREATE INDEX "FeedComment_postId_createdAt_idx" ON "FeedComment"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedComment_authorId_idx" ON "FeedComment"("authorId");

-- CreateIndex
CREATE INDEX "FeedCommentReaction_userId_idx" ON "FeedCommentReaction"("userId");

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_placeEventId_fkey" FOREIGN KEY ("placeEventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_userEventId_fkey" FOREIGN KEY ("userEventId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPostImage" ADD CONSTRAINT "FeedPostImage_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReaction" ADD CONSTRAINT "FeedReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedReaction" ADD CONSTRAINT "FeedReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "FeedPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedComment" ADD CONSTRAINT "FeedComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedCommentReaction" ADD CONSTRAINT "FeedCommentReaction_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "FeedComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedCommentReaction" ADD CONSTRAINT "FeedCommentReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Os posts antigos dentro do evento passam para o feed (a foto, quando havia, vira a primeira imagem).
INSERT INTO "FeedPost" ("id", "authorId", "userEventId", "kind", "body", "status", "createdAt")
SELECT "id", "authorId", "eventId", 'POST', "caption", 'PUBLISHED', "createdAt" FROM "EventPost";
INSERT INTO "FeedPostImage" ("id", "postId", "position", "mime", "data")
SELECT gen_random_uuid(), "id", 0, "mime", "data" FROM "EventPost" WHERE "mime" IS NOT NULL AND "data" IS NOT NULL;

DROP TABLE "EventPost";
ALTER TABLE "Post" DROP COLUMN "eventPostsPublic";

-- Cada publicação pertence a exatamente um alvo.
ALTER TABLE "FeedPost" ADD CONSTRAINT "FeedPost_one_target" CHECK (num_nonnulls("placeEventId", "userEventId", "venueId") = 1);
