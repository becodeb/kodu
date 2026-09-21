-- Corrige los topes de DeepSeek, esta vez enganchando por la CUENTA.
--
-- Las migraciones 20260926000000 y 20260927000000 buscaban
-- `providerModel = 'deepseek-v4-flash'`, que es el nombre con el que se sembro
-- la fila. En produccion el admin lo habia renombrado a 'deepseek-flash' (el
-- nombre actual del modelo; el viejo quedo como alias), asi que el WHERE nunca
-- coincidio y las dos migraciones se saltearon la fila entera: siguio con 8192
-- de salida y 24000 de entrada, que es exactamente lo que cortaba los recursos.
--
-- Atar una migracion de datos al identificador de un modelo es fragil: es un
-- campo que el admin edita desde el panel. La cuenta del proveedor no se
-- renombra, asi que se engancha por ahi.
--
-- Y en vez de exigir un valor exacto, solo SUBE lo que este por debajo. Asi no
-- pisa nada que el admin haya puesto mas alto a proposito, y es idempotente.

-- 1. El techo de salida.
UPDATE "AiModel" m
SET "maxOutputTokens" = 131072
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."kind" = 'deepseek'
  AND m."maxOutputTokens" < 131072;

-- 2. Lo que alcanza a ver del recurso. Con 24.000 caracteres no puede editar un
--    recurso mediano, solo rehacerlo de memoria — que es justo lo que destroza
--    el trabajo del docente (ver el comentario de MAX_HTML_CHARS en prompt.ts).
UPDATE "AiModel" m
SET "maxInputChars" = 400000
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."kind" = 'deepseek'
  AND m."maxInputChars" < 400000;

-- 3. El razonamiento, con el nombre que entiende DeepSeek. Solo si nadie lo
--    definio: si el admin ya eligio, manda el admin.
UPDATE "AiModel" m
SET "reasoningEffort" = 'none',
    "reasoningParam"  = 'reasoning_effort'
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."kind" = 'deepseek'
  AND m."reasoningEffort" IS NULL;

-- 4. El tope por docente pasa a medirse sobre una ventana, en vez de ser un
--    acumulado de por vida que no se repone nunca. Solo si sigue sin ventana.
UPDATE "AiModel" m
SET "userTokenLimit" = 4000000,
    "userTokenWindowHours" = 5
FROM "AiProvider" p
WHERE m."providerId" = p."id"
  AND p."kind" = 'deepseek'
  AND m."userTokenWindowHours" = 0
  AND m."userTokenLimit" > 0
  AND m."userTokenLimit" < 4000000;
