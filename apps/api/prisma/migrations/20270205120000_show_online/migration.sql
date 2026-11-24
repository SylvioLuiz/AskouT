-- Bolinha verde de online: a pessoa pode esconder (e aí também não vê a dos outros).
ALTER TABLE "UserSettings" ADD COLUMN "showOnline" BOOLEAN NOT NULL DEFAULT true;
