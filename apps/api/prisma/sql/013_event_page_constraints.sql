-- Aplicar depois da migration event_page. Pode ser rodado de novo sem erro.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_attendance_one_target') THEN
    ALTER TABLE "EventAttendance" ADD CONSTRAINT event_attendance_one_target CHECK (
      ("placeEventId" IS NOT NULL AND "postId" IS NULL) OR ("placeEventId" IS NULL AND "postId" IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'event_post_shape') THEN
    ALTER TABLE "EventPost" ADD CONSTRAINT event_post_shape CHECK (
      char_length("caption") BETWEEN 1 AND 500
      AND (("mime" IS NULL) = ("data" IS NULL))
      AND ("data" IS NULL OR octet_length("data") <= 102400)
    );
  END IF;
END
$$;
