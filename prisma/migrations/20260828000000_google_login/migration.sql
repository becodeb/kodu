-- Ingreso con Google. Quien entra por ahi no tiene contrasena en Kodu, asi que
-- passwordHash pasa a ser opcional; googleId guarda el `sub`, que identifica la
-- cuenta aunque el correo visible cambie.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "googleId" TEXT;
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");
