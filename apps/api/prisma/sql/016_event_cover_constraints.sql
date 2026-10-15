-- Aplicar depois da migration event_cover. Pode ser rodado de novo sem erro.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'place_event_cover_shape') THEN
    ALTER TABLE "PlaceEventCover" ADD CONSTRAINT place_event_cover_shape CHECK (
      "mime" IN ('image/jpeg', 'image/png', 'image/webp')
      AND octet_length("data") BETWEEN 1 AND 262144
    );
  END IF;
END
$$;
