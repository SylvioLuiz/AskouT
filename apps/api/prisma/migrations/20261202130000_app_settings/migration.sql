-- CreateTable: chaves que a gestão liga e desliga pelo painel (ex.: payments.enabled).
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" UUID,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);
