-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev`:
--
-- 1) La columna que importa mas de esta migracion es `costUsd`, y su escala
--    NO es la misma que la de las tres columnas de precio de `AiModel`
--    (`Decimal(12,6)`). Un turno individual puede costar una fraccion minima
--    de un centavo: 200 tokens cacheados a $0.003 por millon de tokens son
--    $0.0000006. A escala 6 ese numero redondea a `0.000000` -- un costo real
--    quedaria grabado como gratis, que es exactamente la mentira que este
--    cambio existe para evitar. `Decimal(16,10)` pone el piso en
--    $0.0000000001, muy por debajo de cualquier turno real, y Postgres suma
--    exacto sobre `numeric` asi que agregar miles de filas de 10 decimales no
--    pierde nada. `prisma migrate dev` habria generado esta parte sin drama
--    (no hay indice parcial aca), pero se escribe a mano junto con el resto
--    de las migraciones de este cambio por consistencia con esa convencion
--    (ver context.md) y para dejar esta nota donde alguien la vaya a leer.
--
-- 2) `cachedInputTokens` es un SUBCONJUNTO de `promptTokens` en el dialecto
--    OpenAI, no una bolsa aparte (`prompt_tokens_details.cached_tokens`).
--    Facturar los dos enteros duplica el cobro de la porcion cacheada en
--    cada turno despues del primero de un hilo, porque el system prompt y las
--    reglas se reenvian identicos en cada turno de esta app. La resta que
--    corrige eso vive en `src/lib/ai/usage.ts` (`calcularCostoTurno`), no en
--    esta migracion, pero la columna nueva es lo que la hace posible.
--
-- 3) `projectId` deja que un costo se agrupe por recurso (el indicador del
--    docente en el workspace) ademas de por usuario. `ON DELETE SET NULL`:
--    borrar un recurso no debe borrar el registro de lo que costo generarlo.
--
-- 4) Ninguna fila existente se toca. Las filas escritas antes de este cambio
--    quedan con `projectId`/`aiModelId`/`costUsd` en NULL para siempre -- no
--    hay forma honesta de reconstruir un costo que nunca se calculo, y
--    inventarle un precio de hoy a un turno de ayer seria falsificar el
--    historico. Esas filas se muestran como "historico" en la UI, nunca como
--    `US$ 0,00` (que significaria "cost cero", un hecho distinto de "no se
--    sabe").

-- AlterTable
ALTER TABLE "TokenUsage"
  ADD COLUMN "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "costUsd" DECIMAL(16,10),
  ADD COLUMN "priceInputSnapshot" DECIMAL(12,6),
  ADD COLUMN "priceOutputSnapshot" DECIMAL(12,6),
  ADD COLUMN "priceCachedInputSnapshot" DECIMAL(12,6);

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_idx" ON "TokenUsage"("projectId");

-- CreateIndex
CREATE INDEX "TokenUsage_userId_createdAt_idx" ON "TokenUsage"("userId", "createdAt");
