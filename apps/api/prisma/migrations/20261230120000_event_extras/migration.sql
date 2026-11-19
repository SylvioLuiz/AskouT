-- Respostas às configurações de evento cadastradas pela gestão (o catálogo fica no AppSetting `event.extras`).
ALTER TABLE "Post" ADD COLUMN "eventExtras" JSONB NOT NULL DEFAULT '[]';
