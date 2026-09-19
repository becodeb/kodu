/**
 * Formato compacto de tokens ("482,1 k", "1,2 M") para figuras chicas: el
 * trío de estadísticas y los gráficos del detalle de usuario (design.md —
 * "The user detail view"). La tabla de `/admin/usuarios` usa el número
 * completo (`toLocaleString('es-AR')`) porque ahí sí hay lugar de sobra en
 * una columna `text-right tabular-nums`; acá se prioriza que quepa.
 */
export function formatearTokensCompacto(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace('.', ',')} M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1).replace('.', ',')} k`;
  return tokens.toLocaleString('es-AR');
}
