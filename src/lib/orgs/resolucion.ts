import { prisma } from '../db.ts';
import { emailDomain, normalizeEmail } from '../auth/domains.ts';

/**
 * odd/tasks/organizaciones.md (T2): a qué organización pertenece un email —
 * reemplaza a `dominioAutorizado()`/`AuthorizedDomain` (M6), que ya no
 * existen (T1 los borró). Misma caché corta que `auth/domains.ts` tenía
 * (10s): un admin que agrega un dominio o un email a la lista blanca lo ve
 * reflejado en el próximo pedido, sin redeploy.
 */

const CACHE_TTL_MS = 10_000;

interface OrganizacionSnapshot {
  id: string;
  name: string;
  kind: 'CAMPUS' | 'NETWORK';
  archivada: boolean;
}

interface Snapshot {
  /** email normalizado -> organizationId (siempre una CAMPUS, regla de aplicación). */
  porEmail: Map<string, string>;
  dominios: Array<{ pattern: string; organizationId: string }>;
  organizaciones: Map<string, OrganizacionSnapshot>;
  /** Sedes NO archivadas de cada red, para ofrecerlas en el selector (T4). */
  sedesPorRed: Map<string, Array<{ id: string; name: string }>>;
  /**
   * odd/tasks/organizaciones.md (T6): `"<organizationId>:<email>"` — a quien
   * se dio de baja de esa CAMPUS y no puede volver a unirse por DOMINIO a
   * ella (la lista blanca y una invitación son explícitas y ganan: las dos
   * borran la fila de exclusión al usarse, ver gestion.ts/invitaciones.ts).
   */
  exclusiones: Set<string>;
}

function claveExclusion(organizationId: string, email: string): string {
  return `${organizationId}:${email}`;
}

let cache: { datos: Snapshot; expira: number } | null = null;

async function leerSnapshot(): Promise<Snapshot> {
  if (cache && cache.expira > Date.now()) return cache.datos;

  const [emails, dominios, organizaciones, exclusiones] = await Promise.all([
    prisma.organizationAllowedEmail.findMany({ select: { email: true, organizationId: true } }),
    // odd/tasks/planes-y-cobros.md (T5): un dominio PENDING (recién agregado
    // en el alta propia, todavía sin confirmar por el superadmin) no une a
    // nadie — sólo el del creador queda VERIFIED al instante. Filtrar acá
    // (y no en `mejorDominioCoincidente`) evita que un PENDING participe
    // siquiera del "más específico gana" entre comodines.
    prisma.organizationDomain.findMany({
      where: { status: 'VERIFIED' },
      select: { pattern: true, organizationId: true },
    }),
    prisma.organization.findMany({
      select: { id: true, name: true, kind: true, parentId: true, archivedAt: true },
    }),
    prisma.organizationExclusion.findMany({ select: { organizationId: true, email: true } }),
  ]);

  const organizacionesMap = new Map<string, OrganizacionSnapshot>(
    organizaciones.map((org) => [
      org.id,
      { id: org.id, name: org.name, kind: org.kind, archivada: org.archivedAt !== null },
    ]),
  );

  const sedesPorRed = new Map<string, Array<{ id: string; name: string }>>();
  for (const org of organizaciones) {
    if (org.kind === 'CAMPUS' && org.parentId && org.archivedAt === null) {
      const lista = sedesPorRed.get(org.parentId) ?? [];
      lista.push({ id: org.id, name: org.name });
      sedesPorRed.set(org.parentId, lista);
    }
  }

  const datos: Snapshot = {
    porEmail: new Map(emails.map((fila) => [normalizeEmail(fila.email), fila.organizationId])),
    dominios: dominios.map((fila) => ({ pattern: fila.pattern, organizationId: fila.organizationId })),
    organizaciones: organizacionesMap,
    sedesPorRed,
    exclusiones: new Set(exclusiones.map((fila) => claveExclusion(fila.organizationId, fila.email))),
  };

  cache = { datos, expira: Date.now() + CACHE_TTL_MS };
  return datos;
}

/** Se llama desde cualquier mutación de organizaciones/dominios/lista blanca (T4/T6). */
export function invalidarCacheOrganizaciones(): void {
  cache = null;
}

/**
 * El mismo matcher de comodín que `domains.ts` tenía (portado sin tocar el
 * criterio: `*.edu.ar` matchea un subdominio, nunca el dominio desnudo), más
 * "más específico gana" entre comodines: exacto siempre le gana a cualquier
 * comodín, y entre dos comodines el de sufijo más largo (más específico).
 */
function mejorDominioCoincidente(
  domain: string,
  patrones: Array<{ pattern: string; organizationId: string }>,
): string | null {
  let mejor: { pattern: string; organizationId: string } | null = null;

  for (const candidato of patrones) {
    const coincide = candidato.pattern.startsWith('*.')
      ? domain.endsWith(candidato.pattern.slice(1))
      : domain === candidato.pattern;
    if (!coincide) continue;

    if (!mejor) {
      mejor = candidato;
      continue;
    }

    const mejorEsExacto = !mejor.pattern.startsWith('*.');
    const candidatoEsExacto = !candidato.pattern.startsWith('*.');
    if (candidatoEsExacto && !mejorEsExacto) {
      mejor = candidato;
    } else if (candidatoEsExacto === mejorEsExacto && candidato.pattern.length > mejor.pattern.length) {
      mejor = candidato;
    }
  }

  return mejor?.organizationId ?? null;
}

export type ResolucionOrganizacion =
  | { campus: { id: string; name: string } }
  | {
      red: { id: string; name: string };
      requiereElegirSede: true;
      sedes: Array<{ id: string; name: string }>;
    }
  | null;

/**
 * Orden de resolución (decisión del dueño, odd/tasks/organizaciones.md):
 *  1. `OrganizationAllowedEmail` — coincidencia EXACTA de email, siempre una CAMPUS.
 *  2. Dominio — exacto le gana a comodín, el comodín más específico gana entre sí.
 *
 * Ignora organizaciones archivadas (como si no existieran — nunca cae a un
 * candidato peor a propósito, así que una vez descartado el primer match no
 * se sigue buscando otro). Si el dominio pertenece a una `NETWORK`, no
 * resuelve una sede sola: devuelve el picker (T4 lo implementa; acá sólo se
 * expone).
 */
export async function organizacionParaEmail(email: string): Promise<ResolucionOrganizacion> {
  const normalizado = normalizeEmail(email);
  const dominio = emailDomain(normalizado);
  const snapshot = await leerSnapshot();

  const idPorEmail = snapshot.porEmail.get(normalizado);
  if (idPorEmail) {
    const org = snapshot.organizaciones.get(idPorEmail);
    if (org && !org.archivada && org.kind === 'CAMPUS') {
      return { campus: { id: org.id, name: org.name } };
    }
  }

  if (dominio) {
    const idPorDominio = mejorDominioCoincidente(dominio, snapshot.dominios);
    if (idPorDominio) {
      const org = snapshot.organizaciones.get(idPorDominio);
      if (org && !org.archivada) {
        if (org.kind === 'CAMPUS') {
          // T6: a quien se dio de baja de ESTA sede no lo vuelve a unir su
          // propio dominio — tiene que entrar por invitación o lista blanca.
          if (snapshot.exclusiones.has(claveExclusion(org.id, normalizado))) return null;
          return { campus: { id: org.id, name: org.name } };
        }

        // T6: para el picker de una red, se sacan las sedes en las que esta
        // persona está excluida — si eso deja la lista vacía, la red entera
        // deja de resolver (nunca se ofrece un picker sin opciones).
        const sedes = (snapshot.sedesPorRed.get(org.id) ?? []).filter(
          (sede) => !snapshot.exclusiones.has(claveExclusion(sede.id, normalizado)),
        );
        if (sedes.length === 0) return null;

        return { red: { id: org.id, name: org.name }, requiereElegirSede: true, sedes };
      }
    }
  }

  return null;
}
