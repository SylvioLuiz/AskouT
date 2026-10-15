-- Aplicar depois da migration group_management. Pode ser rodado de novo sem erro.

-- (a forma das mensagens é definida por último em 010_voice_constraints.sql; repetir aqui falharia em bancos que já têm mensagens de voz)

-- Foto do grupo guardada como data URL: até ~60 mil caracteres (40 KB de imagem em base64).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_image_size') THEN
    ALTER TABLE "Group" ADD CONSTRAINT group_image_size CHECK ("imageUrl" IS NULL OR (char_length("imageUrl") <= 60000 AND "imageUrl" LIKE 'data:image/%'));
  END IF;
END
$$;
