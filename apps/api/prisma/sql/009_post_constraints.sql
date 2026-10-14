-- Aplicar depois da migration posts. Pode ser rodado de novo sem erro.

-- Cada foto é ou enviada (tipo + bytes até 100 KB) ou do lugar (só a referência), nunca as duas coisas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_image_shape') THEN
    ALTER TABLE "PostImage" ADD CONSTRAINT post_image_shape CHECK (
      ("data" IS NOT NULL AND "mime" IN ('image/jpeg', 'image/png', 'image/webp') AND octet_length("data") BETWEEN 1 AND 102400 AND "placePhotoRef" IS NULL)
      OR ("data" IS NULL AND "mime" IS NULL AND "placePhotoRef" IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_image_position') THEN
    ALTER TABLE "PostImage" ADD CONSTRAINT post_image_position CHECK ("position" BETWEEN 0 AND 4);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_caption_size') THEN
    ALTER TABLE "Post" ADD CONSTRAINT post_caption_size CHECK ("caption" IS NULL OR char_length("caption") BETWEEN 1 AND 2000);
  END IF;
END
$$;

-- Marcação: só os três estados conhecidos.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_tag_status') THEN
    ALTER TABLE "PostTag" ADD CONSTRAINT post_tag_status CHECK ("status" IN ('PENDING', 'ACCEPTED', 'DECLINED'));
  END IF;
END
$$;
