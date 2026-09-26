-- Escrita a mano por la misma razon que las anteriores (los tres indices
-- unicos parciales que Prisma no conoce: no correr `prisma migrate dev`).
--
-- odd/tasks/generacion-simple-y-reanudable.md (T5): marcador por turno de "ya
-- pasaron los chequeos del navegador (self-test -> correccion -> verificador)
-- sobre este HTML". Las filas VIEJAS se backfillean a un instante FIJO, nunca
-- a NULL: si quedaran en NULL, abrir CUALQUIER proyecto viejo despues de este
-- deploy dispararia el pipeline entero sobre un recurso que nunca pidio nada
-- de esto. De aca en mas, `postChecksAt IS NULL` es EXCLUSIVAMENTE "turno
-- nuevo, todavia no paso por el chequeo" — ver
-- decidirResumenChequeosPosteriores en src/lib/ai/post-checks.ts.

ALTER TABLE "ChatMessage" ADD COLUMN "resultHtmlFingerprint" TEXT;
ALTER TABLE "ChatMessage" ADD COLUMN "postChecksAt" TIMESTAMP(3);
ALTER TABLE "ChatMessage" ADD COLUMN "postChecksClaimedAt" TIMESTAMP(3);

UPDATE "ChatMessage" SET "postChecksAt" = '2026-10-07T00:00:00Z'::timestamp;
