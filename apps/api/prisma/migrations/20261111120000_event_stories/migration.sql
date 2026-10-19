-- Stories de evento: foto ou vídeo, 24 h no ar; somem quando o evento é apagado (e o app esconde no fim dele).
CREATE TABLE "EventStory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "placeEventId" UUID,
    "postId" UUID,
    "mime" TEXT NOT NULL,
    "isVideo" BOOLEAN NOT NULL DEFAULT false,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventStory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventStory_one_event" CHECK (("placeEventId" IS NOT NULL) <> ("postId" IS NOT NULL))
);

CREATE INDEX "EventStory_placeEventId_expiresAt_idx" ON "EventStory"("placeEventId", "expiresAt");
CREATE INDEX "EventStory_postId_expiresAt_idx" ON "EventStory"("postId", "expiresAt");
CREATE INDEX "EventStory_userId_idx" ON "EventStory"("userId");

ALTER TABLE "EventStory" ADD CONSTRAINT "EventStory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventStory" ADD CONSTRAINT "EventStory_placeEventId_fkey" FOREIGN KEY ("placeEventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventStory" ADD CONSTRAINT "EventStory_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
