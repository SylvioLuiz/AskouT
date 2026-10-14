-- Aplicar depois da migration conversation_clear_report. Pode ser rodado de novo sem erro.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversation_report_shape') THEN
    ALTER TABLE "ConversationReport" ADD CONSTRAINT conversation_report_shape CHECK (
      "reason" IN ('SPAM', 'OFFENSIVE', 'NUDITY', 'VIOLENCE', 'FALSE_INFO', 'OTHER')
      AND ("details" IS NULL OR char_length("details") <= 300)
      AND char_length("evidence") <= 4000
      AND ("reportedUserId" IS NULL OR "reportedUserId" <> "reporterId")
    );
  END IF;
END
$$;
