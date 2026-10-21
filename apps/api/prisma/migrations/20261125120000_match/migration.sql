-- AlterTable
ALTER TABLE "Boost" ADD COLUMN "audience" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN "radiusM" INTEGER,
ADD COLUMN "matchTags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "UserRegion" (
    "userId" UUID NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserRegion_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "UserRegion_lat_lng_idx" ON "UserRegion"("lat", "lng");

-- AddForeignKey
ALTER TABLE "UserRegion" ADD CONSTRAINT "UserRegion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
