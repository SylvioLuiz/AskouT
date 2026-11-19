-- Local criado do zero em "Meus locais" (pedido com documento): fica fora das buscas até um admin aprovar o dono.
ALTER TABLE "Venue" ADD COLUMN "isUserCreated" BOOLEAN NOT NULL DEFAULT false;
