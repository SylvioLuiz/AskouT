-- CreateEnum
CREATE TYPE "EventKind" AS ENUM ('DIGITAL', 'SHOW', 'CINEMA', 'THEATER', 'EXHIBITION', 'GASTRONOMY', 'NIGHT', 'OTHER');

-- AlterTable
ALTER TABLE "PlaceEvent" ADD COLUMN     "imageUrl" TEXT,
ADD COLUMN     "isFree" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kind" "EventKind" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "PlaceEvent_kind_idx" ON "PlaceEvent"("kind");
