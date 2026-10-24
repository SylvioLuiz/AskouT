-- CreateTable
CREATE TABLE "VenueCalendar" (
    "venueId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "leadDays" INTEGER NOT NULL DEFAULT 7,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastFound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueCalendar_pkey" PRIMARY KEY ("venueId")
);

-- CreateTable
CREATE TABLE "VenueCalendarDraft" (
    "id" UUID NOT NULL,
    "venueId" UUID NOT NULL,
    "occKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" "EventKind" NOT NULL DEFAULT 'OTHER',
    "isFree" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ticketUrl" TEXT,
    "publishAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "publishedEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VenueCalendarDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VenueCalendar_enabled_lastSyncAt_idx" ON "VenueCalendar"("enabled", "lastSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "VenueCalendarDraft_venueId_occKey_key" ON "VenueCalendarDraft"("venueId", "occKey");

-- CreateIndex
CREATE INDEX "VenueCalendarDraft_status_publishAt_idx" ON "VenueCalendarDraft"("status", "publishAt");

-- CreateIndex
CREATE INDEX "VenueCalendarDraft_venueId_startsAt_idx" ON "VenueCalendarDraft"("venueId", "startsAt");

-- AddForeignKey
ALTER TABLE "VenueCalendar" ADD CONSTRAINT "VenueCalendar_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VenueCalendarDraft" ADD CONSTRAINT "VenueCalendarDraft_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
