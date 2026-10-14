-- Aplicar depois da migration profile_posts. Pode ser rodado de novo sem erro.

-- Forma de cada tipo de mensagem: texto e aviso do sistema sem cartão; sugestão com cartão; encontro com o id do
-- encontro; evento compartilhado com o id do evento.
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS message_suggestion_shape;
ALTER TABLE "Message" ADD CONSTRAINT message_suggestion_shape CHECK (
  (kind = 'SUGGESTION' AND suggestion IS NOT NULL AND "meetupId" IS NULL AND "eventId" IS NULL)
  OR (kind IN ('TEXT', 'SYSTEM') AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NULL)
  OR (kind = 'MEETUP' AND suggestion IS NULL AND "meetupId" IS NOT NULL AND "eventId" IS NULL)
  OR (kind = 'EVENT' AND suggestion IS NULL AND "meetupId" IS NULL AND "eventId" IS NOT NULL)
);

-- Foto de perfil: até 80 KB já reduzida (a API confere antes; o banco é a segunda trava).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_photo_size') THEN
    ALTER TABLE "ProfilePhoto" ADD CONSTRAINT profile_photo_size CHECK (octet_length("data") BETWEEN 1 AND 81920 AND "mime" IN ('image/jpeg', 'image/png', 'image/webp'));
  END IF;
END
$$;
