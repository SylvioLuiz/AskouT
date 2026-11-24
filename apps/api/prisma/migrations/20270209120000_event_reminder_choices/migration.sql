-- Lembretes de evento configuráveis: cada lembrete (1 dia antes, "É hoje!", 2 h, 1 h, 30 min, 15 min) é marcado à parte.
-- Os marcadores que já existem são todos do lembrete antigo de 30 min.
ALTER TABLE "EventReminder" ADD COLUMN "kind" TEXT NOT NULL DEFAULT '30m';
DROP INDEX "EventReminder_userId_source_eventId_key";
CREATE UNIQUE INDEX "EventReminder_userId_source_eventId_kind_key" ON "EventReminder"("userId", "source", "eventId", "kind");

-- Escolha geral (nulo = padrão "É hoje!" e 30 min antes) e o fuso do aparelho.
ALTER TABLE "NotificationSetting" ADD COLUMN "eventReminders" TEXT;
ALTER TABLE "NotificationSetting" ADD COLUMN "reminderTimeZone" TEXT;

-- Escolha só para um evento, no lugar da geral.
CREATE TABLE "EventReminderChoice" (
    "userId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "reminders" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventReminderChoice_pkey" PRIMARY KEY ("userId","source","eventId")
);

CREATE INDEX "EventReminderChoice_source_eventId_idx" ON "EventReminderChoice"("source", "eventId");

ALTER TABLE "EventReminderChoice" ADD CONSTRAINT "EventReminderChoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
