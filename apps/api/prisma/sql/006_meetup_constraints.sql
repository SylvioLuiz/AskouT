-- Aplicar depois da migration meetups_groups. Pode ser rodado de novo sem erro.

-- Forma de cada tipo de mensagem: texto sem cartão; sugestão com cartão; encontro com o id do encontro.
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS message_suggestion_shape;
ALTER TABLE "Message" ADD CONSTRAINT message_suggestion_shape CHECK (
  (kind = 'SUGGESTION' AND suggestion IS NOT NULL AND "meetupId" IS NULL)
  OR (kind = 'TEXT' AND suggestion IS NULL AND "meetupId" IS NULL)
  OR (kind = 'MEETUP' AND suggestion IS NULL AND "meetupId" IS NOT NULL)
);

-- Encontro termina depois de começar (quando os dois existem).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_range') THEN
    ALTER TABLE "Meeting" ADD CONSTRAINT meeting_range CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");
  END IF;
END
$$;
