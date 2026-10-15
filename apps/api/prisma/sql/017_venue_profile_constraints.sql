-- Limites do perfil do estabelecimento (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueCover_limits') THEN
    ALTER TABLE "VenueCover" ADD CONSTRAINT "VenueCover_limits" CHECK (
      "mime" IN ('image/jpeg', 'image/png', 'image/webp')
      AND octet_length("data") BETWEEN 1 AND 262144
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Venue_profile_limits') THEN
    ALTER TABLE "Venue" ADD CONSTRAINT "Venue_profile_limits" CHECK (
      ("description" IS NULL OR char_length("description") <= 600)
      AND ("coverUrl" IS NULL OR char_length("coverUrl") <= 500)
    );
  END IF;
END
$$;
