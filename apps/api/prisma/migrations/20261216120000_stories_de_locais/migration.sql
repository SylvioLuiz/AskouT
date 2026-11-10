-- Stories públicos de locais verificados, denúncias, silenciar local e preferência de não ver stories de locais.

CREATE TABLE "VenueStory" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "mime" TEXT NOT NULL,
    "isVideo" BOOLEAN NOT NULL DEFAULT false,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueStory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VenueStoryReport" (
    "id" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" UUID,
    "resolution" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "VenueStoryReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VenueStoryMute" (
    "userId" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VenueStoryMute_pkey" PRIMARY KEY ("userId","venueId")
);

CREATE TABLE "VenueStoryPref" (
    "userId" UUID NOT NULL,
    "hideAll" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VenueStoryPref_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "VenueStory_venueId_expiresAt_idx" ON "VenueStory"("venueId", "expiresAt");
CREATE INDEX "VenueStory_expiresAt_idx" ON "VenueStory"("expiresAt");
CREATE UNIQUE INDEX "VenueStoryReport_storyId_reporterId_key" ON "VenueStoryReport"("storyId", "reporterId");
CREATE INDEX "VenueStoryReport_reporterId_idx" ON "VenueStoryReport"("reporterId");
CREATE INDEX "VenueStoryReport_resolvedAt_createdAt_idx" ON "VenueStoryReport"("resolvedAt", "createdAt");

ALTER TABLE "VenueStory" ADD CONSTRAINT "VenueStory_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueStory" ADD CONSTRAINT "VenueStory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueStoryReport" ADD CONSTRAINT "VenueStoryReport_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "VenueStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueStoryReport" ADD CONSTRAINT "VenueStoryReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueStoryMute" ADD CONSTRAINT "VenueStoryMute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueStoryMute" ADD CONSTRAINT "VenueStoryMute_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VenueStoryPref" ADD CONSTRAINT "VenueStoryPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
