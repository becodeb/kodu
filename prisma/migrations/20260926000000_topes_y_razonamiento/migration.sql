-- Topes de motor y esfuerzo de razonamiento.
--
-- Escrita a mano como el resto de las migraciones de este repo (ver
-- 20260919000000_catalogo_de_motores): `prisma migrate dev` no conserva el
-- indice unico parcial AiModel_un_solo_default. Se registra con
-- `npx prisma migrate resolve --applied 20260926000000_topes_y_razonamiento`.
--
-- Corre sola en el deploy (docker/prod-entrypoint.sh), asi que es aditiva y
-- todos los UPDATE estan guardados por valor: si un admin ya toco esas filas
-- desde el panel, no se le pisa nada.

-- 1. El esfuerzo de razonamiento, por motor.
--
-- NULL = no mandar el parametro. Es el unico default correcto: mandarselo a
-- un proveedor que no lo conoce es un 400. Solo se completa donde se sabe que
-- el modelo lo soporta.
ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "reasoningEffort" TEXT;

-- 2. El techo de salida por defecto sube de 65.536 a 131.072.
--
-- Es un TECHO, no una cuota: se cobra lo que el modelo escribe. Y la IA
-- reescribe el recurso entero en cada turno, no un diff, con lo cual la
-- respuesta pesa lo que pesa el documento. Un techo corto no ahorra plata,
-- corta recursos por la mitad.
--
-- Solo afecta a los motores que se creen de ahora en adelante; las filas que
-- ya existen tienen su valor propio.
ALTER TABLE "AiModel" ALTER COLUMN "maxOutputTokens" SET DEFAULT 131072;

-- 3. DeepSeek deja de estar configurado como respaldo de emergencia.
--
-- Se sembro con 8.192 tokens de salida y 24.000 caracteres de entrada cuando
-- era el ultimo recurso pago y la consigna era gastar poco. Con esos numeros
-- no puede ver un recurso mediano ni terminar de escribirlo: toda respuesta
-- larga vuelve con finish_reason "length".
--
-- El WHERE exige los valores sembrados exactos. Si el admin ya los cambio,
-- esta sentencia no hace nada.
UPDATE "AiModel"
SET "maxOutputTokens" = 131072,
    "maxInputChars"   = 400000
WHERE "providerModel" = 'deepseek-v4-flash'
  AND "maxOutputTokens" = 8192
  AND "maxInputChars" = 24000;

-- 4. DeepSeek arranca sin razonamiento.
--
-- Armar un HTML no es un problema de razonamiento sino de escritura larga: el
-- thinking cuesta tokens y latencia a cambio de poco. Ademas el modo thinking
-- de DeepSeek rechaza el tool_choice forzado (ver ToolChoiceNoSoportado en
-- src/lib/ai/provider.ts) e ignora el temperature que se manda.
--
-- Solo se toca si nadie lo definio todavia.
UPDATE "AiModel"
SET "reasoningEffort" = 'none'
WHERE "providerModel" = 'deepseek-v4-flash'
  AND "reasoningEffort" IS NULL;
