import { prisma } from '../../db.ts';
import type { LoginTicket } from './arca.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8c): persistencia del TA de WSAA —
 * `ArcaAccessTicket` en la base (ver `prisma/schema.prisma`). Reemplaza el
 * cache en memoria original de T8: ese cache se perdía en cada reinicio del
 * servidor y WSAA RECHAZA un login nuevo mientras el TA anterior sigue
 * vigente (`coe.alreadyAuthenticated`, ~12hs de validez), así que un deploy
 * podía dejar la facturación rota hasta que ese TA huérfano venciera.
 *
 * `TicketStore` es una interfaz chica, inyectable, para que
 * `e2e/unidad-facturador.ts` pruebe el manejo de concurrencia/expiración con
 * un store en memoria, sin tocar la base de datos real.
 */
export interface TicketStore {
  /** Lee el TA vigente guardado (si hay) para `cuit:entorno:service`. */
  leer(cuit: string, entorno: string, service: string): Promise<LoginTicket | null>;
  /**
   * Guarda el TA recién obtenido y devuelve el valor guardado. `withLock`
   * ejecuta `fn` bajo un lock exclusivo de esta llave (para que dos procesos
   * no logueen en paralelo y uno pise el TA del otro con uno más viejo).
   */
  withLock<T>(cuit: string, entorno: string, service: string, fn: () => Promise<T>): Promise<T>;
  guardar(cuit: string, entorno: string, service: string, ticket: LoginTicket): Promise<void>;
}

/**
 * Store respaldado en Postgres vía Prisma. El lock usa
 * `pg_advisory_xact_lock` (se libera solo al terminar la transacción, aunque
 * `fn` tire una excepción) sobre un hash estable de la llave — más simple que
 * una fila con `SELECT ... FOR UPDATE` porque no necesita que la fila exista
 * de antemano (el primer login para un cuit/entorno/service nuevo no tiene
 * fila todavía).
 */
export const ticketStorePrisma: TicketStore = {
  async leer(cuit, entorno, service) {
    const fila = await prisma.arcaAccessTicket.findUnique({ where: { cuit_entorno_service: { cuit, entorno, service } } });
    if (!fila) return null;
    return { token: fila.token, sign: fila.sign, expirationTime: fila.expirationTime };
  },

  async withLock(cuit, entorno, service, fn) {
    const clave = `${cuit}:${entorno}:${service}`;
    return prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${clave}))`;
        return fn();
      },
      { timeout: 30_000 },
    );
  },

  async guardar(cuit, entorno, service, ticket) {
    await prisma.arcaAccessTicket.upsert({
      where: { cuit_entorno_service: { cuit, entorno, service } },
      create: { cuit, entorno, service, token: ticket.token, sign: ticket.sign, generationTime: new Date(), expirationTime: ticket.expirationTime },
      update: { token: ticket.token, sign: ticket.sign, generationTime: new Date(), expirationTime: ticket.expirationTime },
    });
  },
};

/** Store en memoria, para pruebas (`e2e/unidad-facturador.ts`) — mismo
 *  comportamiento de lock serializado (una promesa encadenada por llave, no
 *  hay dos "procesos" reales en un test de unidad). */
export function crearTicketStoreEnMemoria(): TicketStore {
  const tickets = new Map<string, LoginTicket>();
  const colas = new Map<string, Promise<unknown>>();

  function clave(cuit: string, entorno: string, service: string): string {
    return `${cuit}:${entorno}:${service}`;
  }

  return {
    async leer(cuit, entorno, service) {
      return tickets.get(clave(cuit, entorno, service)) ?? null;
    },
    async withLock<T>(cuit: string, entorno: string, service: string, fn: () => Promise<T>): Promise<T> {
      const k = clave(cuit, entorno, service);
      const previa = colas.get(k) ?? Promise.resolve();
      const corrida = previa.then(fn, fn);
      colas.set(
        k,
        corrida.catch(() => undefined),
      );
      return corrida;
    },
    async guardar(cuit, entorno, service, ticket) {
      tickets.set(clave(cuit, entorno, service), ticket);
    },
  };
}
