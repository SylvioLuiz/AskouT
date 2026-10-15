-- Aplicar depois da migration venue_claims. Pode ser rodado de novo sem erro.

-- Uma pessoa não tem dois pedidos em análise para o mesmo local.
CREATE UNIQUE INDEX IF NOT EXISTS venue_claim_one_pending ON "VenueClaim" ("venueId", "userId") WHERE "status" = 'PENDING';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'venue_claim_shape') THEN
    ALTER TABLE "VenueClaim" ADD CONSTRAINT venue_claim_shape CHECK (
      "documentMime" IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      AND octet_length("document") BETWEEN 1 AND 2097152
      AND ("note" IS NULL OR char_length("note") <= 300)
      AND ("reviewNote" IS NULL OR char_length("reviewNote") <= 300)
      AND (("status" = 'PENDING') = ("reviewedAt" IS NULL))
    );
  END IF;
END
$$;
