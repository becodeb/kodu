-- El techo de MiniMax y el nombre del parametro de razonamiento.
--
-- Escrita a mano como el resto. Aditiva, corre sola en el deploy, y los UPDATE
-- estan guardados por valor exacto: si un admin ya toco esas filas desde el
-- panel, no se le pisa nada.

-- 1. Con que nombre viaja el razonamiento.
--
-- No hay uno solo: DeepSeek habla el dialecto OpenAI y toma `reasoning_effort`
-- con el nivel; MiniMax M3 toma `thinking: {type}`. Mandarle el de uno al otro
-- es un 400, asi que cada motor guarda cual usa.
ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "reasoningParam" TEXT;

-- 2. DeepSeek ya tenia el nivel cargado; le falta decir con que nombre va.
UPDATE "AiModel"
SET "reasoningParam" = 'reasoning_effort'
WHERE "providerModel" = 'deepseek-v4-flash'
  AND "reasoningEffort" IS NOT NULL
  AND "reasoningParam" IS NULL;

-- 3. El techo de MiniMax sube de 65.536 a 131.072.
--
-- ESTA es la causa de que se corten los recursos, medida y no supuesta.
-- MiniMax documenta 131.072 como salida recomendada para M3 y Kodu le estaba
-- mandando la mitad. Ademas M3 razona por defecto, y el razonamiento se
-- descuenta del mismo techo: medido contra la API de DeepSeek con el prompt
-- que fallaba, 28.743 de 37.931 tokens de salida fueron razonamiento. Con
-- 65.536 de techo, un recurso grande no entra.
UPDATE "AiModel"
SET "maxOutputTokens" = 131072
WHERE "providerModel" IN ('MiniMaxAI/MiniMax-M3', 'MiniMaxAI/MiniMax-M2.7')
  AND "maxOutputTokens" = 65536;

-- 4. A MiniMax se le deja el razonamiento COMO ESTA (encendido).
--
-- Apagarlo ahorraria bastante: en la medicion, razonar costo 5 veces mas
-- tokens para un HTML del mismo tamano (27.409 caracteres contra 28.042). Pero
-- MiniMax es el motor principal de los docentes y eso es un cambio de conducta
-- sobre todo lo que se genera, no un arreglo de un defecto. Queda a un clic en
-- /admin/motores: "Razonamiento" en «sin razonamiento» y "Como se lo manda" en
-- "thinking". Subir el techo alcanza para que deje de cortarse.
