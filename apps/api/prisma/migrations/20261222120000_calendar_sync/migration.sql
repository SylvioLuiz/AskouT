-- Sincronizar agendas: agenda do celular, link iCal e Google Agenda (só horários ocupados, nunca título).

-- AlterEnum
ALTER TYPE "CalendarProvider" ADD VALUE 'DEVICE';
ALTER TYPE "CalendarProvider" ADD VALUE 'ICS';

-- AlterTable
ALTER TABLE "CalendarConnection" ADD COLUMN "sourceEnc" TEXT,
ADD COLUMN "label" TEXT,
ADD COLUMN "accountEmail" TEXT,
ADD COLUMN "calendars" JSONB,
ADD COLUMN "lastError" TEXT;

-- CreateIndex
CREATE INDEX "CalendarBusyInterval_startsAt_idx" ON "CalendarBusyInterval"("startsAt");
