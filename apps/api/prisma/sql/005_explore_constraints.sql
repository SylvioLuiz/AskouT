-- Imagem só por https e hashtags com no máximo 10 itens.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_event_image_https') THEN
    ALTER TABLE "PlaceEvent" ADD CONSTRAINT place_event_image_https CHECK ("imageUrl" IS NULL OR "imageUrl" LIKE 'https://%');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_event_tags_max') THEN
    ALTER TABLE "PlaceEvent" ADD CONSTRAINT place_event_tags_max CHECK (cardinality(tags) <= 10);
  END IF;
END
$$;
