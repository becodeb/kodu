import type { Speed } from '../workspace-types.ts';

/**
 * T6 ("Velocidad Rápido / A fondo"): la última elección de ESTE navegador
 * persiste en `localStorage` (decisión del dueño), para no volver a arrancar
 * siempre en el default de la cuenta apenas alguien tocó el control una vez.
 */

const STORAGE_KEY = 'kodu-velocidad';

/** Separada de la lectura de `localStorage` de abajo para poder probarla sin DOM. */
export function esVelocidadValida(valor: string | null): valor is Speed {
  return valor === 'fast' || valor === 'deep';
}

/** `null` si este navegador nunca eligió ninguna: ahí manda `velocidadPorDefecto`
 *  (ver `Capacidades` en `lib/ai/capacidades.ts`), no un default fijo acá. */
export function leerVelocidadGuardada(): Speed | null {
  try {
    const guardado = window.localStorage.getItem(STORAGE_KEY);
    return esVelocidadValida(guardado) ? guardado : null;
  } catch {
    // Modo privado, cookies bloqueadas, etc.: seguimos sin memoria, no rompemos el turno.
    return null;
  }
}

export function guardarVelocidad(speed: Speed): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, speed);
  } catch {
    // Si no se puede guardar, sólo se pierde la persistencia entre sesiones.
  }
}
