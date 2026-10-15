-- Nota do estabelecimento: de 1 a 5 (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueRating_stars') THEN
    ALTER TABLE "VenueRating" ADD CONSTRAINT "VenueRating_stars" CHECK ("stars" BETWEEN 1 AND 5);
  END IF;
END
$$;
