-- Aplicar depois da migration group_management. Pode ser rodado de novo sem erro.

-- Forma de cada tipo de mensagem: texto e aviso do sistema sem cartão; sugestão com cartão; encontro com o id do encontro.
ALTER TABLE "Message" DROP CONSTRAINT IF EXISTS message_suggestion_shape;
ALTER TABLE "Message" ADD CONSTRAINT message_suggestion_shape CHECK (
  (kind = 'SUGGESTION' AND suggestion IS NOT NULL AND "meetupId" IS NULL)
  OR (kind IN ('TEXT', 'SYSTEM') AND suggestion IS NULL AND "meetupId" IS NULL)
  OR (kind = 'MEETUP' AND suggestion IS NULL AND "meetupId" IS NOT NULL)
);

-- Foto do grupo guardada como data URL: até ~60 mil caracteres (40 KB de imagem em base64).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_image_size') THEN
    ALTER TABLE "Group" ADD CONSTRAINT group_image_size CHECK ("imageUrl" IS NULL OR (char_length("imageUrl") <= 60000 AND "imageUrl" LIKE 'data:image/%'));
  END IF;
END
$$;
