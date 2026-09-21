-- Rollback de 20260929000000_topes_deepseek_por_cuenta.
--
-- NO lo ejecuta Prisma. No hay nada estructural que revertir: son cuatro
-- UPDATE de datos. Volver a bajar los topes reintroduciria el defecto que
-- cortaba los recursos, asi que este archivo a proposito NO los baja.
--
-- Si de verdad los queres distintos, cambialos desde /admin/motores.

DO $$
BEGIN
  RAISE NOTICE 'Nada que revertir: esta migracion solo sube topes que estaban';
  RAISE NOTICE 'por debajo del minimo utilizable. Ajustalos desde /admin/motores.';
END $$;
