-- Celular no perfil (privado), para amigos acharem a pessoa pela agenda do celular.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "phoneHash" TEXT;

CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");
CREATE UNIQUE INDEX "User_phoneHash_key" ON "User"("phoneHash");
