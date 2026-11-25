-- Evento adiado (sem nova data ainda): quando foi marcado. Marcar uma nova data tira o adiado.
ALTER TABLE "Post" ADD COLUMN "eventPostponedAt" TIMESTAMP(3);
ALTER TABLE "PlaceEvent" ADD COLUMN "postponedAt" TIMESTAMP(3);
