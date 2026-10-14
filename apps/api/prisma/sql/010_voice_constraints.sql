-- Aplicar depois da migration voice_messages. Pode ser rodado de novo sem erro.

-- Forma de cada tipo de mensagem, agora com mensagem de voz: sem cartão, sem encontro, sem evento e com duração.
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS message_suggestion_shape;
ALTER TABLE "Message" ADD CONSTRAINT message_suggestion_shape CHECK (
  (kind = 'SUGGESTION' AND suggestion IS NOT NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "audioMs" IS NULL)
  OR (kind IN ('TEXT', 'SYSTEM') AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "audioMs" IS NULL)
  OR (kind = 'MEETUP' AND suggestion IS NULL AND "meetupId" IS NOT NULL AND "eventId" IS NULL AND "audioMs" IS NULL)
  OR (kind = 'EVENT' AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NOT NULL AND "audioMs" IS NULL)
  OR (kind = 'AUDIO' AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NULL AND "audioMs" BETWEEN 1000 AND 90000)
);

-- Áudio: até 600 KB e só formatos de gravação de navegador (a API confere antes; o banco é a segunda trava).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_audio_size') THEN
    ALTER TABLE "MessageAudio" ADD CONSTRAINT message_audio_size CHECK (octet_length("data") BETWEEN 16 AND 614400 AND "mime" IN ('audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a'));
  END IF;
END
$$;
