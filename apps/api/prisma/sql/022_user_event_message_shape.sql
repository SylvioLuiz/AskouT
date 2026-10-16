-- Aplicar depois da migration user_event_sharing. Pode ser rodado de novo sem erro.
-- Mensagem de evento leva um evento de local (eventId) OU um evento de pessoa (postEventId), nunca os dois.
-- Só cria se ainda não houver a versão com postEventId (a 023 troca esta regra por uma que aceita foto e vídeo;
-- recriar esta num banco que já tem foto ou vídeo falharia).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_suggestion_shape' AND conrelid = '"Message"'::regclass AND pg_get_constraintdef(oid) LIKE '%postEventId%') THEN
    RETURN;
  END IF;
  ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS message_suggestion_shape;
  ALTER TABLE "Message" ADD CONSTRAINT message_suggestion_shape CHECK (
    (kind = 'SUGGESTION' AND suggestion IS NOT NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" IS NULL)
    OR (kind IN ('TEXT', 'SYSTEM') AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" IS NULL)
    OR (kind = 'MEETUP' AND suggestion IS NULL AND "meetupId" IS NOT NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" IS NULL)
    OR (kind = 'EVENT' AND suggestion IS NULL AND "meetupId" IS NULL AND (("eventId" IS NOT NULL AND "postEventId" IS NULL) OR ("eventId" IS NULL AND "postEventId" IS NOT NULL)) AND "audioMs" IS NULL)
    OR (kind = 'AUDIO' AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "postEventId" IS NULL AND "audioMs" BETWEEN 1000 AND 90000)
  );
END
$$;
