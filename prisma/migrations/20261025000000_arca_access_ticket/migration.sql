-- CreateTable
CREATE TABLE "ArcaAccessTicket" (
    "id" TEXT NOT NULL,
    "cuit" TEXT NOT NULL,
    "entorno" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sign" TEXT NOT NULL,
    "generationTime" TIMESTAMP(3) NOT NULL,
    "expirationTime" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArcaAccessTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArcaAccessTicket_cuit_entorno_service_key" ON "ArcaAccessTicket"("cuit", "entorno", "service");
