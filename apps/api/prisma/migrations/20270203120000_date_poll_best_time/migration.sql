-- Votação com horário (BEST_TIME e BEST_DATE_TIME): os horários (HH:MM) em votação.
ALTER TABLE "DatePoll" ADD COLUMN "candidateTimes" TEXT[] NOT NULL DEFAULT '{}';
