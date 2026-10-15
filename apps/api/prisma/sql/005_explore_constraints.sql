-- Hashtags (a regra da imagem está em 020_event_image_source.sql) com no máximo 10 itens.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_event_tags_max') THEN
    ALTER TABLE "PlaceEvent" ADD CONSTRAINT place_event_tags_max CHECK (cardinality(tags) <= 10);
  END IF;
END
$$;
