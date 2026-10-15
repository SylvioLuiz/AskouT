-- Limites da logo do estabelecimento (idempotente).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VenueLogo_limits') THEN
    ALTER TABLE "VenueLogo" ADD CONSTRAINT "VenueLogo_limits" CHECK (
      "mime" IN ('image/jpeg', 'image/png', 'image/webp')
      AND octet_length("data") BETWEEN 1 AND 131072
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Venue_logo_limits') THEN
    ALTER TABLE "Venue" ADD CONSTRAINT "Venue_logo_limits" CHECK ("logoUrl" IS NULL OR char_length("logoUrl") <= 500);
  END IF;
END
$$;
