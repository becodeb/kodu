-- El tope por docente pasa a medirse sobre una ventana movil.
--
-- Escrita a mano como el resto (ver 20260919000000_catalogo_de_motores) y
-- registrada con `npx prisma migrate resolve --applied`. Corre sola en el
-- deploy, es aditiva, y el UPDATE esta guardado por valor exacto: si un admin
-- ya toco esa fila desde el panel, no se le pisa nada.

-- 1. La ventana, en horas. 0 = desde siempre, que es lo que habia hasta ahora.
--
-- Movil y no un ciclo que se reinicia: se suman las ultimas N horas contra
-- TokenUsage.createdAt, que ya tiene indice [userId, createdAt]. Sin trabajo
-- programado, sin contador que se pueda corromper, y el cupo se libera de a
-- poco en vez de volver todo junto a una hora fija.
ALTER TABLE "AiModel" ADD COLUMN IF NOT EXISTS "userTokenWindowHours" INTEGER NOT NULL DEFAULT 0;

-- 2. DeepSeek: 4.000.000 de tokens sobre 5 horas, en vez de 300.000 de por vida.
--
-- El tope viejo era acumulado y NO se reponia: al llegar, ese docente perdia
-- DeepSeek para siempre. Ademas quedo corto por lo que costaba entonces, y
-- este motor acaba de recibir topes de largo mucho mas grandes
-- (20260926000000), asi que cada turno suyo pesa mas que antes.
--
-- El numero sale del consumo medido, no de la intuicion: 33.700 tokens por
-- turno en promedio, 45.000 el pico, y el dia mas pesado de un docente fueron
-- 765.000 en total. 4.000.000 en cinco horas es como cinco veces ese dia
-- entero, comprimido en un quinto del tiempo: una persona no lo toca.
--
-- El objetivo no es racionar a los docentes, que entran por dominio conocido
-- y son gente de confianza. Es cortar un BUCLE: algo que reintenta solo de
-- madrugada y quema creditos sin que nadie mire. Con ventana de 5 horas eso
-- se frena rapido; con un tope diario se lo comeria entero.
UPDATE "AiModel"
SET "userTokenLimit" = 4000000,
    "userTokenWindowHours" = 5
WHERE "providerModel" = 'deepseek-v4-flash'
  AND "userTokenLimit" = 300000
  AND "userTokenWindowHours" = 0;
