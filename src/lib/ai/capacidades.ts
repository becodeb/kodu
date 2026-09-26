/**
 * Qué puede hacer ESTE docente en ESTE turno
 * (odd/tasks/generacion-simple-y-reanudable.md, T1/T2).
 *
 * Módulo puro a propósito: no toca la base ni el caché de `AppSettings` (eso
 * ya lo resuelve `lib/settings.ts`) — sólo combina lo que YA se leyó de
 * `AppSettings` según la regla del dueño.
 *
 * El modo de calidad discreto y los interruptores nunca medidos con ganancia real
 * (velocidad, revisión automática "para todos", motores exclusivos) se
 * sacaron enteros (odd/tasks/generacion-simple-y-reanudable.md, decisión del
 * dueño 2026-09-26). Lo único que sobrevive de la "capa 1" es el interruptor
 * `versionsForAll`: teachers may turn on 3 versions in their own projects,
 * pero SÓLO cuando este interruptor también está prendido — ver
 * `Project.versionsEnabled` y `src/lib/ai/versiones.ts`.
 */

export interface SettingsParaCapacidades {
  versionsForAll: boolean;
}

export interface Capacidades {
  /**
   * El admin permite que los docentes activen "3 versiones" en sus propios
   * proyectos. Server-only en el sentido de que el cliente sólo recibe esto
   * combinado con `Project.versionsEnabled` — nunca la bandera cruda de
   * `AppSettings` (ver `CapacidadesEditor` en `workspace-types.ts`).
   */
  puedePedirVersiones: boolean;
}

/**
 * Pura: la misma `settings` siempre da el mismo resultado, sin I/O. Quien
 * llama es responsable de traer `AppSettings` ya fresco — tiene su propia
 * caché de 10s (`lib/settings.ts`).
 */
export function resolverCapacidades(settings: SettingsParaCapacidades): Capacidades {
  return { puedePedirVersiones: settings.versionsForAll };
}
