import type { MiembroOrganizacion } from './gestion.ts';

/**
 * Búsqueda, filtro y orden de la lista de docentes de una sede (`MiembrosLista`).
 *
 * Todo del lado del cliente sobre los miembros que ya trajo el SSR: una sede
 * tiene decenas de docentes, no miles. Va en un módulo aparte (puro, sin React
 * ni Prisma) para poder probarlo sin navegador y para que el componente
 * quede sólo con la interfaz.
 */

export type FiltroMiembros = 'todos' | 'admins' | 'docentes' | 'inactivos';
export type OrdenMiembros = 'nombre' | 'recursos' | 'actividad';

export interface ConsultaMiembros {
  busqueda: string;
  filtro: FiltroMiembros;
  orden: OrdenMiembros;
}

/** "Sin actividad": nunca tocó nada, o lo último fue hace más de estos días. */
export const DIAS_SIN_ACTIVIDAD = 30;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Minúsculas y sin acentos: "Lucía" se encuentra escribiendo "lucia" (y al revés). */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function sinActividadReciente(miembro: MiembroOrganizacion, ahora: number): boolean {
  if (miembro.ultimaActividad === null) return true;
  const ultima = new Date(miembro.ultimaActividad).getTime();
  return ahora - ultima > DIAS_SIN_ACTIVIDAD * DIA_MS;
}

function coincideFiltro(miembro: MiembroOrganizacion, filtro: FiltroMiembros, ahora: number): boolean {
  if (filtro === 'admins') return miembro.esAdmin;
  if (filtro === 'docentes') return !miembro.esAdmin;
  if (filtro === 'inactivos') return sinActividadReciente(miembro, ahora);
  return true;
}

function porNombre(a: MiembroOrganizacion, b: MiembroOrganizacion): number {
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.email.localeCompare(b.email);
}

function porOrden(orden: OrdenMiembros): (a: MiembroOrganizacion, b: MiembroOrganizacion) => number {
  if (orden === 'recursos') return (a, b) => b.recursos - a.recursos || porNombre(a, b);
  if (orden === 'actividad') {
    // Más reciente primero; quien nunca hizo nada va al final.
    const marca = (m: MiembroOrganizacion) => (m.ultimaActividad === null ? -Infinity : new Date(m.ultimaActividad).getTime());
    return (a, b) => {
      const diferencia = marca(b) - marca(a);
      return Number.isNaN(diferencia) || diferencia === 0 ? porNombre(a, b) : diferencia;
    };
  }
  return porNombre;
}

/**
 * Cada palabra de la búsqueda tiene que aparecer en el nombre o en el email
 * ("ana perez" encuentra a "Ana María Pérez"), sin importar mayúsculas ni
 * acentos. No muta la lista que recibe.
 */
export function filtrarYOrdenar(
  miembros: readonly MiembroOrganizacion[],
  consulta: ConsultaMiembros,
  ahora: number = Date.now(),
): MiembroOrganizacion[] {
  const palabras = normalizarBusqueda(consulta.busqueda).split(/\s+/).filter(Boolean);
  return miembros
    .filter((miembro) => {
      if (!coincideFiltro(miembro, consulta.filtro, ahora)) return false;
      if (palabras.length === 0) return true;
      const pajar = normalizarBusqueda(`${miembro.name} ${miembro.email}`);
      return palabras.every((palabra) => pajar.includes(palabra));
    })
    .sort(porOrden(consulta.orden));
}
