-- Resposta só existe em cartão de sugestão, e vem sempre com o horário.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_response_shape') THEN
    ALTER TABLE "Message" ADD CONSTRAINT message_response_shape CHECK (
      (response IS NULL AND "respondedAt" IS NULL) OR (response IS NOT NULL AND "respondedAt" IS NOT NULL AND kind = 'SUGGESTION')
    );
  END IF;
END
$$;
