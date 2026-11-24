-- Aplicar depois da 021. Pode ser rodado de novo sem erro.
-- Votação com horário: BEST_TIME (um dia só, vota de 2 a 12 horários) e BEST_DATE_TIME (vota os dias e os horários).
-- O voto num horário guarda HH:MM em "candidateDate" (o voto num dia segue AAAA-MM-DD).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DatePoll_shape' AND pg_get_constraintdef(oid) LIKE '%BEST_DATE_TIME%') THEN
    ALTER TABLE "DatePoll" DROP CONSTRAINT IF EXISTS "DatePoll_shape";
    ALTER TABLE "DatePoll" ADD CONSTRAINT "DatePoll_shape" CHECK (
      "schedulingMode" IN ('BEST_DATE', 'BEST_TIME', 'BEST_DATE_TIME')
      AND "rangeStart" ~ '^\d{4}-\d{2}-\d{2}$' AND "rangeEnd" ~ '^\d{4}-\d{2}-\d{2}$'
      AND "rangeEnd" >= "rangeStart"
      AND ("schedulingMode" = 'BEST_DATE' OR cardinality("candidateTimes") BETWEEN 2 AND 12)
      AND ("schedulingMode" <> 'BEST_TIME' OR "rangeEnd" = "rangeStart")
      AND "durationMinutes" BETWEEN 15 AND 1440
      AND ("preferredTimeStart" IS NULL OR "preferredTimeStart" ~ '^([01]\d|2[0-3]):[0-5]\d$')
      AND "confirmationPolicy" IN ('UNANIMITY', 'MAJORITY', 'MANUAL')
      AND "status" IN ('VOTING', 'CONFIRMING', 'FINALIZED', 'CANCELLED')
      AND "greenMin" BETWEEN 1 AND 100 AND "orangeMin" BETWEEN 0 AND 100 AND "orangeMin" < "greenMin"
      AND "minCoverage" BETWEEN 0 AND 100
      AND char_length("title") BETWEEN 1 AND 120
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DatePollVote_shape' AND pg_get_constraintdef(oid) LIKE '%[01]%') THEN
    ALTER TABLE "DatePollVote" DROP CONSTRAINT IF EXISTS "DatePollVote_shape";
    ALTER TABLE "DatePollVote" ADD CONSTRAINT "DatePollVote_shape" CHECK (
      "status" IN ('YES', 'MAYBE', 'NO')
      AND ("candidateDate" ~ '^\d{4}-\d{2}-\d{2}$' OR "candidateDate" ~ '^([01]\d|2[0-3]):[0-5]\d$')
    );
  END IF;
END
$$;
