-- POR QUE esta migracion esta escrita a mano y no generada por
-- `prisma migrate dev` (misma convencion que 20260919000000, 20260923000000 y
-- 20260924000000):
--
-- 1) Esta base tiene DOS indices unicos PARCIALES que Prisma no sabe expresar
--    en el schema: `AiModel_un_solo_default` (WHERE "isDefault" = true) y
--    `User_un_solo_demo`. `prisma migrate dev` genera un diff que no los
--    encuentra en el schema y los DROPEA. Esta migracion no los toca, pero se
--    escribe a mano por esa misma disciplina y se marca aplicada con
--    `prisma migrate resolve --applied`.
--
-- 2) El backfill tiene que ser SQL PURO. El deploy es un webhook de Coolify:
--    `docker/prod-entrypoint.sh:11` corre `npx prisma migrate deploy` y
--    arranca el server. La imagen de runtime NO puede correr un script de
--    TypeScript (`Dockerfile:51` = `npm ci --omit=dev`, sin tsx; el COPY de
--    `Dockerfile:53-56` no incluye `scripts/`). Nadie va a entrar a mano a
--    terminar esto.
--
-- 3) Todo lo de abajo es ADITIVO. No se borra ninguna columna, no se re-keyea
--    ninguna fila y no se toca una sola primitiva de cripto. La peor falla
--    posible es una tabla que todavia no existe, no una clave que dejo de
--    descifrar.
--
-- 4) NO se despublica ningun recurso que hoy este en la galeria sin portada.
--    Ver el comentario del backfill.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProjectLike" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectLike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Un like por docente por recurso: es toda la regla anti-abuso que hay. El
-- doble click del navegador choca contra esto, no contra logica de la app.
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectLike_userId_projectId_key"
    ON "ProjectLike"("userId", "projectId");

-- CreateIndex
-- El unique de arriba arranca por "userId", asi que NO puede servir el conteo
-- por recurso ni el join del `orderBy: { likes: { _count: 'desc' } }` de la
-- galeria. Este si, y ademas le da un indice al FK para el borrado en cascada.
CREATE INDEX IF NOT EXISTS "ProjectLike_projectId_idx" ON "ProjectLike"("projectId");

-- AddForeignKey
-- Los dos en CASCADE: si se borra el recurso, sus likes no significan nada; si
-- se borra la cuenta del docente, su like tampoco, porque un like ES la
-- persona (por eso el unique lleva "userId" y por eso no puede ser NULL).
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectLike_userId_fkey') THEN
        ALTER TABLE "ProjectLike"
          ADD CONSTRAINT "ProjectLike_userId_fkey"
          FOREIGN KEY ("userId") REFERENCES "User"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProjectLike_projectId_fkey') THEN
        ALTER TABLE "ProjectLike"
          ADD CONSTRAINT "ProjectLike_projectId_fkey"
          FOREIGN KEY ("projectId") REFERENCES "Project"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "screenshotAt" TIMESTAMP(3);

-- Backfill: toda portada que ya existe se declara SACADA AL DIA.
--
-- Sin esto, el dia del deploy TODOS los recursos con portada quedarian con
-- screenshotAt = NULL y, si NULL se leyera como "vieja", la app entera
-- amanece gritando "Actualizar portada". Por eso pasan dos cosas: este UPDATE,
-- y que el predicado de §6 trate NULL como FRESCA. Las dos, no una.
--
-- `= "updatedAt"` y no CURRENT_TIMESTAMP: deja screenshotAt EXACTAMENTE igual
-- a updatedAt, que es el unico valor que garantiza que el predicado de §6 de
-- "fresca" con cualquier tolerancia, incluso cero.
UPDATE "Project"
   SET "screenshotAt" = "updatedAt"
 WHERE "screenshotUrl" IS NOT NULL
   AND "screenshotAt" IS NULL;

-- LO QUE ESTA MIGRACION NO HACE, A PROPOSITO:
-- No corre `UPDATE "Project" SET "isInGallery" = false WHERE "screenshotUrl"
-- IS NULL`. Despublicar el recurso de un docente sin avisarle es sacarle el
-- trabajo de la estanteria en silencio, y el rollback NO lo puede deshacer:
-- el esquema previo no guarda en ningun lado cuales filas se dieron vuelta,
-- asi que la reversion no tiene como distinguirlas de las que ya estaban
-- privadas. La invariante nueva rige de aca en adelante (ver §3); las filas
-- viejas sin portada siguen mostrando el marcador "Sin captura" que la galeria
-- ya dibuja (gallery.astro:57-61) y se arreglan solas la primera vez que su
-- dueño saque una portada.
