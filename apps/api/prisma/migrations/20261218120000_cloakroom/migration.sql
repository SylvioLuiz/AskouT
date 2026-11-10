-- Chapelaria (guarda-volumes) de evento.

-- CreateEnum
CREATE TYPE "CloakroomStatus" AS ENUM ('ISSUED', 'STORED', 'RETURNED', 'CANCELED');

-- CreateTable
CREATE TABLE "CloakroomSetting" (
    "placeEventId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priceCents" INTEGER,
    "capacity" INTEGER,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CloakroomSetting_pkey" PRIMARY KEY ("placeEventId")
);

-- CreateTable
CREATE TABLE "CloakroomTicket" (
    "id" UUID NOT NULL,
    "placeEventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 1,
    "status" "CloakroomStatus" NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "CloakroomTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CloakroomTicket_placeEventId_code_key" ON "CloakroomTicket"("placeEventId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CloakroomTicket_placeEventId_number_key" ON "CloakroomTicket"("placeEventId", "number");

-- CreateIndex
CREATE INDEX "CloakroomTicket_userId_createdAt_idx" ON "CloakroomTicket"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "CloakroomSetting" ADD CONSTRAINT "CloakroomSetting_placeEventId_fkey" FOREIGN KEY ("placeEventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloakroomTicket" ADD CONSTRAINT "CloakroomTicket_placeEventId_fkey" FOREIGN KEY ("placeEventId") REFERENCES "PlaceEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CloakroomTicket" ADD CONSTRAINT "CloakroomTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
