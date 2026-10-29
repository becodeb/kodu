-- Institutional bands raised for demo day (2026-10-30). The previous prices
-- are kept here so they can be restored with a later migration:
-- Pequeña 95.000/950.000, Mediana 155.000/1.550.000, Grande 280.000/2.800.000.
-- New: Pequeña 155.000/1.550.000; Mediana 280.000/2.800.000; Grande
-- 350.000/3.500.000. Cycle price stays at 10 months.
UPDATE "InstitutionalBand"
SET "monthlyPriceArs" = 155000, "cyclePriceArs" = 1550000
WHERE "key" = 'PEQUENA' AND "monthlyPriceArs" = 95000 AND "cyclePriceArs" = 950000;

UPDATE "InstitutionalBand"
SET "monthlyPriceArs" = 280000, "cyclePriceArs" = 2800000
WHERE "key" = 'MEDIANA' AND "monthlyPriceArs" = 155000 AND "cyclePriceArs" = 1550000;

UPDATE "InstitutionalBand"
SET "monthlyPriceArs" = 350000, "cyclePriceArs" = 3500000
WHERE "key" = 'GRANDE' AND "monthlyPriceArs" = 280000 AND "cyclePriceArs" = 2800000;
