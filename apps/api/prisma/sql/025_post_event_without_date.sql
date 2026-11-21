-- Aplicar depois da 009. Pode ser rodado de novo sem erro.
-- Evento de pessoa pode nascer sem data quando ela vai ser decidida numa votação: título sem início e sem fim.
-- Com data, início e fim continuam vindo juntos e o fim não é antes do início.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_event_shape' AND conrelid = '"Post"'::regclass AND pg_get_constraintdef(oid) LIKE '%"eventStartsAt" IS NULL) AND ("eventEndsAt" IS NULL%') THEN
    RETURN;
  END IF;
  ALTER TABLE "Post" DROP CONSTRAINT IF EXISTS post_event_shape;
  ALTER TABLE "Post" ADD CONSTRAINT post_event_shape CHECK (
    ("eventTitle" IS NULL AND "eventStartsAt" IS NULL AND "eventEndsAt" IS NULL)
    OR (
      "eventTitle" IS NOT NULL AND char_length("eventTitle") BETWEEN 1 AND 120
      AND (
        ("eventStartsAt" IS NOT NULL AND "eventEndsAt" IS NOT NULL AND "eventEndsAt" >= "eventStartsAt")
        OR ("eventStartsAt" IS NULL AND "eventEndsAt" IS NULL)
      )
    )
  );
END
$$;
