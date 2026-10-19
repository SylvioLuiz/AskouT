-- Silenciar avisos: tudo, só conversas ou só eventos.
CREATE TABLE "NotificationSetting" (
    "userId" UUID NOT NULL,
    "muteAll" BOOLEAN NOT NULL DEFAULT false,
    "muteChats" BOOLEAN NOT NULL DEFAULT false,
    "muteEvents" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
