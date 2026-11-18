-- Nota en La Nación (nov 2026): Kodu se anunció como gratis y va a entrar
-- mucha gente a probarla. Las cuentas gratuitas crean sus 2 primeros recursos
-- con Sonnet 5.5 y después con Haiku 5.5 (src/lib/billing/cuenta-gratuita.ts).
-- La bienvenida del plan FREE sube para que alcance para unos 10 recursos:
--   2 con Sonnet  ≈ USD 0,19 c/u con sus ajustes ≈ 372 créditos
--   8 con Haiku   ≈ USD 0,025 c/u               ≈ 200 créditos
-- 500 de bienvenida + 50 del mes ≈ 550 créditos (USD 0,001 por crédito).
--
-- GREATEST: nunca baja un valor que un admin ya haya subido a mano desde
-- /admin/precios. Sólo afecta cuentas que todavía no recibieron la
-- bienvenida (se otorga una vez). Para volver atrás, bajarlo desde
-- /admin/precios.
UPDATE "IndividualPlan"
SET "welcomeCredits" = GREATEST("welcomeCredits", 500),
    "updatedAt" = NOW()
WHERE "key" = 'FREE';
