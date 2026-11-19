-- Story com texto por cima da foto/vídeo: o texto e a altura onde fica na tela (0 = topo, 1 = pé).
ALTER TABLE "EventStory" ADD COLUMN "caption" TEXT;
ALTER TABLE "EventStory" ADD COLUMN "captionY" DOUBLE PRECISION;
