-- Escrita a mano por la misma razon que 20261006000000_quitar_prime (los tres
-- indices unicos parciales que Prisma no conoce).
--
-- odd/tasks/generacion-simple-y-reanudable.md (T2): "3 versiones" pasa de ser
-- un pedido por turno (prime o `AppSettings.versionsForAll`) a un interruptor
-- por proyecto, aditivo y apagado por default. El servidor sigue exigiendo
-- `AppSettings.versionsForAll` ADEMAS de esta columna — ver
-- `src/lib/ai/versiones.ts`/`capacidades.ts`.

ALTER TABLE "Project" ADD COLUMN "versionsEnabled" BOOLEAN NOT NULL DEFAULT false;
