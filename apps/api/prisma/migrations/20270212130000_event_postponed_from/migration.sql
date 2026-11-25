-- Evento adiado com nova data: guarda o início de antes. Nulo (com o adiado marcado): nova data ainda a definir.
ALTER TABLE "Post" ADD COLUMN "eventPostponedFrom" TIMESTAMP(3);
ALTER TABLE "PlaceEvent" ADD COLUMN "postponedFrom" TIMESTAMP(3);
