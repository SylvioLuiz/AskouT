-- Aplicar depois da migration flash_hidden. Pode ser rodado de novo sem erro.

-- Ninguém oculta o Flash de si mesmo, e a linha só existe se alguma ocultação está ligada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flash_hidden_shape') THEN
    ALTER TABLE "FlashHidden" ADD CONSTRAINT flash_hidden_shape CHECK ("ownerId" <> "otherId" AND ("hideTheirs" OR "hideMine"));
  END IF;
END
$$;
