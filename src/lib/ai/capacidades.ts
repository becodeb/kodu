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
 * les toca; el editor sólo recibe los dos campos genéricos
 * (`puedeElegirVelocidad`, `puedePedirVersiones`), armados aparte en
 * `project/[id].astro` como `CapacidadesEditor` (`workspace-types.ts`) —
 * nunca este objeto entero.
 */

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
    puedePedirVersiones: prime || settings.versionsForAll,
    autoReviewForAll: settings.autoReviewForAll,
    puedeUsarModelosPrime: prime,
  };
}
