/**
 * Qué puede hacer ESTE docente en ESTE turno (T5, odd/tasks/modo-prime.md —
 * "Modo prime y funciones para todos").
 *
 * Módulo puro a propósito: no toca la base ni el caché de `AppSettings` (eso
 * ya lo resuelve `lib/settings.ts`) — sólo combina lo que YA se leyó de
 * `User` y de `AppSettings` según la regla del dueño. Los tipos de entrada
 * son estructurales (no importan `SessionUser` ni el `AppSettings` de
 * Prisma): cualquier objeto con estos campos sirve, así las pruebas no
 * tienen que armar un `User` completo.
 *
 * Se llama UNA vez por turno/carga de página, siempre del lado del
 * servidor: `prime` y las banderas crudas de `AppSettings` nunca cruzan al
 * navegador ("Discreto" en las decisiones del dueño — un docente sin prime
 * no tiene que poder enterarse de que existe, ni leyendo el código fuente
 * de la página). Los consumidores server-side (`stream.ts`,
 * `project/[id].astro`, y T6/T7/T9 más adelante) leen de acá el campo que
 * les toca; el editor sólo recibe los campos genéricos
 * (`puedeElegirVelocidad`, `velocidadPorDefecto`, `puedePedirVersiones`),
 * armados aparte en `project/[id].astro` como `CapacidadesEditor`
 * (`workspace-types.ts`) — nunca este objeto entero.
 */

import type { Speed } from './provider.ts';

export interface UsuarioParaCapacidades {
  role: 'DOCENTE' | 'ADMIN';
  isDemo: boolean;
  /** Cuenta marcada a mano por un admin (`User.primeAccess`). */
  primeAccess: boolean;
}

export interface SettingsParaCapacidades {
  primeEnabled: boolean;
  autoReviewForAll: boolean;
  deepModeForAll: boolean;
  versionsForAll: boolean;
}

export interface Capacidades {
  /**
   * Alcanza a: admins, la cuenta demo, y las cuentas que un admin marcó —
   * pero SÓLO si el interruptor general también está prendido (decisiones
   * del dueño, no reabrir). Server-only.
   */
  prime: boolean;
  /**
   * T6 ("Velocidad Rápido / A fondo"): puede elegir velocidad en el
   * compositor. Prime siempre la tiene (capa 2); sin prime, sólo si el
   * admin prendió "A fondo para todos" (capa 1, `deepModeForAll`).
   */
  puedeElegirVelocidad: boolean;
  /**
   * T6: qué velocidad mostrar seleccionada en este navegador cuando todavía
   * no eligió ninguna (nada guardado en su `localStorage`). `'a_fondo'` para
   * quien tiene prime de verdad; `'rapido'` para quien sólo tiene el control
   * por `deepModeForAll` (capa 1, "lo que no encarece va para todos" — A
   * fondo SÍ encarece, así que no es lo que se le prende por default a
   * alguien que no eligió prime para esa cuenta). Vocabulario en español y
   * distinto del `Speed` del proveedor a propósito: esto es sólo una
   * preferencia de UI, nunca la palabra "prime" — ver `CapacidadesEditor`.
   */
  velocidadPorDefecto: 'a_fondo' | 'rapido';
  /**
   * T9 ("Varias versiones al crear"): puede pedir varias versiones. Mismo
   * criterio que `puedeElegirVelocidad`, con `versionsForAll` en vez de
   * `deepModeForAll`.
   */
  puedePedirVersiones: boolean;
  /**
   * T7 ("Revisión automática"): la bandera cruda de "para todos". T7 la
   * combina con la velocidad YA ELEGIDA en este turno (A fondo también
   * dispara la revisión automática), así que acá viaja tal cual, sin
   * mezclarla con `prime` — mezclarla haría que un prime en Rápido reciba
   * una pasada que las decisiones del dueño no piden para esa velocidad.
   */
  autoReviewForAll: boolean;
  /**
   * Si el catálogo (`catalogo.ts`) puede resolver, listar o usar como
   * respaldo un motor `primeOnly` para este pedido. Hoy es siempre igual a
   * `prime` (un motor prime-only no tiene una capa "para todos" propia),
   * pero queda con su propio nombre para que quien filtra motores no tenga
   * que saber POR QUÉ esta cuenta tiene prime.
   */
  puedeUsarModelosPrime: boolean;
}

/**
 * Pura: el mismo `user` + `settings` siempre da el mismo resultado, sin I/O.
 * Quien llama es responsable de traer los dos ya frescos — el rol y
 * `primeAccess` se releen de la base en cada request gateado
 * (`src/middleware.ts`), y `AppSettings` tiene su propia caché de 10s
 * (`lib/settings.ts`).
 */
export function resolverCapacidades(
  user: UsuarioParaCapacidades,
  settings: SettingsParaCapacidades,
): Capacidades {
  const prime = settings.primeEnabled && (user.role === 'ADMIN' || user.isDemo || user.primeAccess);

  return {
    prime,
    puedeElegirVelocidad: prime || settings.deepModeForAll,
    velocidadPorDefecto: prime ? 'a_fondo' : 'rapido',
    puedePedirVersiones: prime || settings.versionsForAll,
    autoReviewForAll: settings.autoReviewForAll,
    puedeUsarModelosPrime: prime,
  };
}

/**
 * T6 ("Velocidad Rápido / A fondo"): qué velocidad rige ESTE turno —
 * capacidad × pedido × default, en ese orden.
 *
 * Sin `puedeElegirVelocidad`, la velocidad pedida se IGNORA por completo
 * (decisiones del dueño: "un docente sin prime... no puede forzar por API
 * ni velocidad"): da `null`, que para `razonamientoEfectivo`
 * (`lib/ai/provider.ts`) significa "no pisar nada", así el motor manda
 * exactamente el razonamiento que ya tenía configurado, como si T6 no
 * existiera. Nunca se cae a `'fast'`/`'deep'` por default en este caso —
 * eso SÍ sería pisarlo, aunque coincida por casualidad con lo configurado.
 *
 * Con el permiso, la velocidad PEDIDA manda si vino en el body; si no, se
 * usa el default de esta cuenta (`velocidadPorDefecto`, ver `Capacidades`).
 */
export function resolverVelocidadEfectiva(
  puedeElegirVelocidad: boolean,
  velocidadPedida: Speed | undefined,
  velocidadPorDefecto: 'a_fondo' | 'rapido',
): Speed | null {
  if (!puedeElegirVelocidad) return null;
  return velocidadPedida ?? (velocidadPorDefecto === 'a_fondo' ? 'deep' : 'fast');
}
