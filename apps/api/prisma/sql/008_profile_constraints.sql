-- Aplicar depois da migration profile_posts. Pode ser rodado de novo sem erro.

-- (a forma das mensagens é definida por último em 010_voice_constraints.sql; repetir aqui falharia em bancos que já têm mensagens de voz)

-- Foto de perfil: até 80 KB já reduzida (a API confere antes; o banco é a segunda trava).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profile_photo_size') THEN
    ALTER TABLE "ProfilePhoto" ADD CONSTRAINT profile_photo_size CHECK (octet_length("data") BETWEEN 1 AND 81920 AND "mime" IN ('image/jpeg', 'image/png', 'image/webp'));
  END IF;
END
$$;
