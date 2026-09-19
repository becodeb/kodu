-- Rehearsal — escenario de aborto del down-migration.
--
-- Corre DESPUÉS de la migración hacia adelante sobre el DB escratch (post
-- seed.ts + migrate deploy). Arma la colisión que `migration_down.sql` tiene
-- que detectar y abortar: el MISMO providerModel en DOS AiProvider del MISMO
-- kind — exactamente lo que esta migración vino a habilitar, y por eso el
-- índice único viejo (`provider`, `providerModel`) no puede volver sin que
-- alguien decida a mano cuál de los dos motores sobra.
--
-- Reusa las 2 cuentas del caso (c) sembrado por seed.ts (mismo kind
-- "rehearsal-c", 2 AiProvider distintos) y les cuelga un motor con el mismo
-- providerModel a cada una.
INSERT INTO "AiModel"
  ("id", "providerId", "providerModel", "displayName", "enabled", "selectableByTeacher", "isDefault", "sortOrder",
   "maxOutputTokens", "maxInputChars", "supportsVision", "userTokenLimit", "createdAt", "updatedAt")
SELECT gen_random_uuid(), p.id, 'choque-rehearsal-down', 'Rehearsal choque down-migration', true, false, false,
       (SELECT COALESCE(MAX("sortOrder"), 0) + 1 FROM "AiModel"),
       65536, 400000, false, 0, now(), now()
  FROM "AiProvider" p
 WHERE p.kind = 'rehearsal-c';
