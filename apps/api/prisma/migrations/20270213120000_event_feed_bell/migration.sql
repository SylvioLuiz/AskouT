-- Sininho do feed de evento: quem ligou recebe um aviso a cada publicação nova de outra pessoa.
CREATE TABLE "FeedBell" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "placeEventId" UUID,
    "userEventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedBell_pkey" PRIMARY KEY ("id"),
    -- Um evento por linha: ou de um local, ou criado por pessoa.
    CONSTRAINT "FeedBell_one_event" CHECK (("placeEventId" IS NULL) <> ("userEventId" IS NULL))
);

CREATE UNIQUE INDEX "FeedBell_userId_placeEventId_key" ON "FeedBell"("userId", "placeEventId");
CREATE UNIQUE INDEX "FeedBell_userId_userEventId_key" ON "FeedBell"("userId", "userEventId");
CREATE INDEX "FeedBell_placeEventId_createdAt_idx" ON "FeedBell"("placeEventId", "createdAt");
CREATE INDEX "FeedBell_userEventId_createdAt_idx" ON "FeedBell"("userEventId", "createdAt");

ALTER TABLE "FeedBell" ADD CONSTRAINT "FeedBell_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedBell" ADD CONSTRAINT "FeedBell_placeEventId_fkey" FOREIGN KEY ("placeEventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeedBell" ADD CONSTRAINT "FeedBell_userEventId_fkey" FOREIGN KEY ("userEventId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
