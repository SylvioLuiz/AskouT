-- Aplicar depois da migration story_hidden. Pode ser rodado de novo sem erro.

-- Ninguém oculta os próprios stories de si mesmo, e a linha só existe se alguma ocultação está ligada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_hidden_shape') THEN
    ALTER TABLE "StoryHidden" ADD CONSTRAINT story_hidden_shape CHECK ("ownerId" <> "otherId" AND ("hideTheirs" OR "hideMine"));
  END IF;
END
$$;
