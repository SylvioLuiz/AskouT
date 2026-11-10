-- CreateTable
CREATE TABLE "BoostDailyStat" (
    "boostId" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BoostDailyStat_pkey" PRIMARY KEY ("boostId","day","placement","kind")
);

-- CreateTable
CREATE TABLE "BoostSeen" (
    "boostId" UUID NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "viewerKey" TEXT NOT NULL,

    CONSTRAINT "BoostSeen_pkey" PRIMARY KEY ("boostId","day","kind","viewerKey")
);

-- CreateIndex
CREATE INDEX "BoostSeen_day_idx" ON "BoostSeen"("day");

-- AddForeignKey
ALTER TABLE "BoostDailyStat" ADD CONSTRAINT "BoostDailyStat_boostId_fkey" FOREIGN KEY ("boostId") REFERENCES "Boost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoostSeen" ADD CONSTRAINT "BoostSeen_boostId_fkey" FOREIGN KEY ("boostId") REFERENCES "Boost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
