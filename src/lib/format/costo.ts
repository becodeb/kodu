/**
 * Formateo de un costo en USD para mostrarlo (design.md §2 — "Display is a
 * separate concern from storage"). Sin ninguna dependencia de servidor a
 * propósito: este módulo lo importa tanto código de página (server) como una
 * isla de React (`IndicadorConsumo.tsx`, cliente), así que nunca puede
 * arrastrar `src/lib/db.ts` ni el cliente de Prisma generado — eso rompería
 * el bundle del navegador (motor de consultas, resolución del adaptador de
 * base, etc.). Por diseño recibe `string | number`, nunca `Prisma.Decimal`:
 * todo llamador ya tuvo que cruzar el borde servidor→cliente antes de llegar
 * acá, y ese cruce es exactamente el que obliga a `.toString()` un `Decimal`
 * (design.md §2 — "un `Decimal` handed to a React island silently becomes
 * `{}`"). Usar `Number()` para el REDONDEO DE PANTALLA de un solo valor ya
 * calculado es seguro (`float64` tiene de sobra los ~4 decimales que hace
 * falta mostrar); la precisión exacta de `Decimal` importa para el CÁLCULO y
 * la SUMA agregada, que pasan por `src/lib/ai/usage.ts`, no por acá.
 *
 * Regla de redondeo, exactamente la tabla de design.md §2:
 *  - `NULL` (precio nunca cargado)        → "—"
 *  - exactamente `0`, con precios cargados → "US$ 0,00" (el motor gratuito sirvió el turno)
 *  - `>= 0.01`                             → 2 decimales
 *  - `> 0` y `< 0.01`                      → 4 decimales
 *  - redondea a `0,0000` pero es `> 0`     → "menos de US$ 0,0001" — NUNCA
 *    "US$ 0,00", que se lee como gratis y no lo es.
 */
export function formatearCostoUsd(valor: string | number | null): string {
  if (valor === null) return '—';

  const numero = typeof valor === 'number' ? valor : Number(valor);

  if (numero === 0) return formatearMonto(0, 2);
  if (numero >= 0.01) return formatearMonto(numero, 2);

  // Entre 0 y 0.01: puede seguir siendo demasiado chico para 4 decimales
  // (p. ej. $0.00003), y en ese caso "US$ 0,0000" mentiría igual que
  // "US$ 0,00" — de ahí la frase explícita en vez de un cero.
  const redondeadoA4 = Math.round(numero * 10_000) / 10_000;
  if (redondeadoA4 === 0) return 'menos de US$ 0,0001';

  return formatearMonto(numero, 4);
}

function formatearMonto(valor: number, decimales: number): string {
  const texto = valor.toLocaleString('es-AR', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
  return `US$ ${texto}`;
}
