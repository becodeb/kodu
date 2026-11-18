-- Nota en La Nación (nov 2026): Kodu se anunció como gratis y va a entrar
-- mucha gente a probarla. Las cuentas gratuitas ahora crean siempre con
-- Claude Haiku 5.5 (src/lib/billing/cuenta-gratuita.ts), y la bienvenida del
-- plan FREE sube para que alcance para unos 10 recursos con Haiku
-- (≈ USD 0,025 por recurso con sus ajustes ≈ 25 créditos a USD 0,001).
--
-- GREATEST: nunca baja un valor que un admin ya haya subido a mano desde
-- /admin/precios. Sólo afecta cuentas NUEVAS (la bienvenida se otorga una vez).
-- Para volver atrás, bajarlo desde /admin/precios.
UPDATE "IndividualPlan"
SET "welcomeCredits" = GREATEST("welcomeCredits", 250),
    "updatedAt" = NOW()
WHERE "key" = 'FREE';
