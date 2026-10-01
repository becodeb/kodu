/**
 * odd/tasks/ahorro-tokens.md (T4): mismo criterio de escape que
 * `src/pages/api/admin/metricas.csv.ts#celdaCsv` (RFC4180 — comillas cuando
 * el valor trae coma, comilla o salto de línea), factoreado acá porque el
 * export de trazas necesita escapar texto LIBRE del docente (`requestText`),
 * que puede traer cualquiera de los tres a la vez.
 */
export function csvEscape(valor: string | number | boolean | null | undefined): string {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (/["\n\r,]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

export function filaCsv(valores: Array<string | number | boolean | null | undefined>): string {
  return valores.map(csvEscape).join(',');
}
