-- Lista VIP (nome na lista) dos eventos de locais.

-- CreateTable
CREATE TABLE "GuestList" (
    "eventId" UUID NOT NULL,
    "limit" INTEGER,
    "closesAt" TIMESTAMP(3),
    "maxCompanions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestList_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "GuestListEntry" (
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "companions" INTEGER NOT NULL DEFAULT 0,
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestListEntry_pkey" PRIMARY KEY ("eventId","userId")
);

-- CreateIndex
CREATE INDEX "GuestListEntry_userId_idx" ON "GuestListEntry"("userId");

-- AddForeignKey
ALTER TABLE "GuestList" ADD CONSTRAINT "GuestList_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestListEntry" ADD CONSTRAINT "GuestListEntry_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GuestList"("eventId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuestListEntry" ADD CONSTRAINT "GuestListEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
