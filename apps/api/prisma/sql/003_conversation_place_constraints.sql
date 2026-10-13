-- Aplicar depois da migration conversations_places. Pode ser rodado de novo sem erro (idempotente).

-- Uma conversa DIRECT sempre tem a chave da dupla; uma conversa de grupo nunca tem.
DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT conversation_direct_key CHECK (
    (type = 'DIRECT' AND "directKey" IS NOT NULL) OR (type <> 'DIRECT' AND "directKey" IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Mensagem de sugestão precisa do cartão; mensagem de texto não leva cartão.
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT message_suggestion_shape CHECK (
    (kind = 'SUGGESTION' AND suggestion IS NOT NULL) OR (kind = 'TEXT' AND suggestion IS NULL)
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Texto limitado a 2000 caracteres (a API valida antes; isto é a rede de segurança).
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT message_body_length CHECK (char_length(body) BETWEEN 1 AND 2000);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Coordenadas válidas e evento com fim depois do início.
DO $$ BEGIN
  ALTER TABLE "Venue" ADD CONSTRAINT venue_lat CHECK (lat BETWEEN -90 AND 90);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Venue" ADD CONSTRAINT venue_lng CHECK (lng BETWEEN -180 AND 180);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PlaceEvent" ADD CONSTRAINT place_event_range CHECK ("endsAt" > "startsAt");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
