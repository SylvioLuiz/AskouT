-- Regras da votação de datas (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DatePoll_shape') THEN
    ALTER TABLE "DatePoll" ADD CONSTRAINT "DatePoll_shape" CHECK (
      "schedulingMode" IN ('BEST_DATE')
      AND "rangeStart" ~ '^\d{4}-\d{2}-\d{2}$' AND "rangeEnd" ~ '^\d{4}-\d{2}-\d{2}$'
      AND "rangeEnd" >= "rangeStart"
      AND "durationMinutes" BETWEEN 15 AND 1440
      AND ("preferredTimeStart" IS NULL OR "preferredTimeStart" ~ '^([01]\d|2[0-3]):[0-5]\d$')
      AND "confirmationPolicy" IN ('UNANIMITY', 'MAJORITY', 'MANUAL')
      AND "status" IN ('VOTING', 'CONFIRMING', 'FINALIZED', 'CANCELLED')
      AND "greenMin" BETWEEN 1 AND 100 AND "orangeMin" BETWEEN 0 AND 100 AND "orangeMin" < "greenMin"
      AND "minCoverage" BETWEEN 0 AND 100
      AND char_length("title") BETWEEN 1 AND 120
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DatePollVote_shape') THEN
    ALTER TABLE "DatePollVote" ADD CONSTRAINT "DatePollVote_shape" CHECK (
      "status" IN ('YES', 'MAYBE', 'NO') AND "candidateDate" ~ '^\d{4}-\d{2}-\d{2}$'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DatePollProposal_shape') THEN
    ALTER TABLE "DatePollProposal" ADD CONSTRAINT "DatePollProposal_shape" CHECK (
      "status" IN ('OPEN', 'CONFIRMED', 'REJECTED', 'WITHDRAWN')
      AND "candidateDate" ~ '^\d{4}-\d{2}-\d{2}$'
      AND "candidateEndAt" > "candidateStartAt"
      AND "coverageScore" BETWEEN 0 AND 100
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DatePollConfirmation_shape') THEN
    ALTER TABLE "DatePollConfirmation" ADD CONSTRAINT "DatePollConfirmation_shape" CHECK (
      "status" IN ('CONFIRMED', 'ADJUST', 'DECLINED')
    );
  END IF;
  -- No máximo uma proposta aberta por votação.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'DatePollProposal_one_open') THEN
    CREATE UNIQUE INDEX "DatePollProposal_one_open" ON "DatePollProposal"("pollId") WHERE "status" = 'OPEN';
  END IF;
END
$$;
