-- Initial price catalog (odd/tasks/planes-y-cobros.md).
--
-- Production never runs prisma/seed.ts (docker/prod-entrypoint.sh only runs
-- `migrate deploy`), so without this migration a fresh deploy would boot with
-- empty InstitutionalBand and IndividualPlan tables and /precios would have
-- nothing to show. Inserts the owner's launch prices only when the row does
-- not exist yet: rows created by the seed or edited from /admin/precios are
-- never touched.

INSERT INTO "InstitutionalBand" ("id", "key", "name", "minStudents", "maxStudents", "monthlyPriceArs", "cyclePriceArs", "active", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'PEQUENA', 'Pequeña', 1, 300, 95000, 950000, true, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'MEDIANA', 'Mediana', 301, 800, 155000, 1550000, true, 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'GRANDE', 'Grande', 801, 1500, 280000, 2800000, true, 2, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "IndividualPlan" ("id", "key", "name", "monthlyPriceArs", "annualPriceArs", "monthlyCredits", "welcomeCredits", "active", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'FREE', 'Gratis', 0, NULL, 50, 100, true, 0, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'INDIVIDUAL', 'Individual', 7900, 79000, 2500, 0, true, 1, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
