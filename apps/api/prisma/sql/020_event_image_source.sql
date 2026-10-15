-- A capa do evento pode ser https externo ou a rota interna /place-events/<id>/cover (idempotente).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_event_image_https') THEN
    ALTER TABLE "PlaceEvent" DROP CONSTRAINT place_event_image_https;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_event_image_source') THEN
    ALTER TABLE "PlaceEvent" ADD CONSTRAINT place_event_image_source CHECK (
      "imageUrl" IS NULL OR "imageUrl" LIKE 'https://%' OR "imageUrl" LIKE '/place-events/%/cover%'
    );
  END IF;
END
$$;
