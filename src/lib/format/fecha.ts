/**
 * Fechas legibles para el panel admin (design.md — "The users table" /
 * "The user detail view"). Sin ninguna dependencia de servidor a propósito,
 * mismo motivo que `costo.ts`: tanto una página (server) como un componente
 * puramente presentacional pueden importar este módulo sin arrastrar nunca
 * el cliente de Prisma generado.
 */

/**
 * "hace 3 días", para la columna "Última actividad" de la tabla.
 * `null` = el usuario nunca generó ninguna actividad registrada (ni un
 * turno de IA, ni un recurso tocado) — no es lo mismo que "hace mucho".
 */
export function haceTiempo(fecha: string | Date | null): string {
  if (fecha === null) return 'Nunca';

  const entonces = typeof fecha === 'string' ? new Date(fecha) : fecha;
  const segundos = Math.max(0, (Date.now() - entonces.getTime()) / 1000);

  if (segundos < 60) return 'Recién';

  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;

  const dias = Math.floor(horas / 24);
  if (dias === 1) return 'ayer';
  if (dias < 30) return `hace ${dias} días`;

  const meses = Math.floor(dias / 30);
  if (meses < 12) return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;

  const años = Math.floor(meses / 12);
  return `hace ${años} ${años === 1 ? 'año' : 'años'}`;
}

/** "4 de marzo", para el encabezado del detalle ("se sumó el ..."). */
export function fechaLarga(fecha: string | Date): string {
  const valor = typeof fecha === 'string' ? new Date(fecha) : fecha;
  return valor.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
}
