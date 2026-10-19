-- CreateTable
CREATE TABLE "EventReminder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventReminder_sentAt_idx" ON "EventReminder"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "EventReminder_userId_source_eventId_key" ON "EventReminder"("userId", "source", "eventId");
