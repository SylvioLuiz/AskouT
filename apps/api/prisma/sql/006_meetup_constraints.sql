-- Aplicar depois da migration meetups_groups. Pode ser rodado de novo sem erro.

-- (a forma das mensagens é definida por último em 010_voice_constraints.sql; repetir aqui falharia em bancos que já têm mensagens de voz)

-- Encontro termina depois de começar (quando os dois existem).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'meeting_range') THEN
    ALTER TABLE "Meeting" ADD CONSTRAINT meeting_range CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt");
  END IF;
END
$$;
