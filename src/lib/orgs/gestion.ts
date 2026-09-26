import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { normalizeEmail, emailDomain } from '../auth/domains.ts';
import { emailConfiable } from './membresia.ts';
import { alcanceDeAdmin, puedeAdministrar } from './alcance.ts';
import { invalidarCacheOrganizaciones } from './resolucion.ts';
import type { OrganizationKind } from '../../generated/prisma/client.ts';

/**
 * odd/tasks/organizaciones.md (T6): TODA operación de alta de colegio/red/sede,
 * dominios, lista blanca, docentes y admins pasa por acá — nunca reimplementa
 * la autorización en la ruta. T8 (panel de la organización) reusa las MISMAS
 * funciones para su propio admin de organización (no superadmin); lo único
 * que cambia entre los dos es el `actor` que se les pasa.
 *
 * Cada función autoriza sola contra `alcance.ts` (el chokepoint): nunca hace
 * falta llamar a `requireOrgAdmin`/`requireFreshOrgAdmin` antes — de hecho acá
 * no hay `organizationId` fijo de la URL para esas guardas en las rutas que
 * mueven cosas ENTRE organizaciones (`moverMiembro`).
 */

export interface ActorGestion {
  id: string;
  role: 'DOCENTE' | 'ADMIN';
}

/** Toda falla de negocio de este archivo (autorización, validación, conflicto) sale por acá. */
export class GestionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'GestionError';
  }
}

async function exigirSuperadmin(actor: ActorGestion): Promise<void> {
  const alcance = await alcanceDeAdmin(actor);
  if (!alcance.esSuperadmin) {
    throw new GestionError('Sólo el superadmin puede hacer esto.', 403);
  }
}

/** 404 (no 403) para una organización ajena — mismo criterio que `requireOrgAdmin`. */
async function exigirPuedeAdministrar(actor: ActorGestion, organizationId: string): Promise<void> {
  const puede = await puedeAdministrar(actor, organizationId);
  if (!puede) throw new GestionError('No encontramos esa organización.', 404);
}

async function obtenerOrganizacionOFallar(organizationId: string) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new GestionError('No encontramos esa organización.', 404);
  return org;
}

// ─────────────────────────────────────────────────────────────
// Alta, renombre, archivado
// ─────────────────────────────────────────────────────────────

export interface DatosNuevaOrganizacion {
  name: string;
  kind: OrganizationKind;
  /** Sólo para una CAMPUS que nace DENTRO de una NETWORK existente. */
  parentId?: string | null;
}

/**
 * Alta de colegio (CAMPUS standalone), red (NETWORK) o sede de una red
 * (CAMPUS con parentId) — sólo el superadmin (decisión del dueño: "el
 * superadmin crea la organización").
 */
export async function crearOrganizacion(actor: ActorGestion, datos: DatosNuevaOrganizacion) {
  await exigirSuperadmin(actor);

  const name = datos.name.trim();
  if (!name) throw new GestionError('Falta el nombre.', 422);
  if (name.length > 200) throw new GestionError('El nombre es demasiado largo.', 422);

  if (datos.kind === 'NETWORK') {
    if (datos.parentId) throw new GestionError('Una red no puede colgar de otra organización.', 422);
  } else if (datos.parentId) {
    const padre = await prisma.organization.findUnique({ where: { id: datos.parentId } });
    if (!padre || padre.kind !== 'NETWORK') {
      throw new GestionError('La red elegida no existe.', 422);
    }
    if (padre.archivedAt !== null) {
      throw new GestionError('Esa red está archivada.', 409);
    }
  }

  const creada = await prisma.organization.create({
    data: { name, kind: datos.kind, parentId: datos.kind === 'CAMPUS' ? (datos.parentId ?? null) : null },
  });

  // Una sede nueva de una red que YA tiene dominio compartido cambia el
  // picker de esa red (sedesPorRed) — invalidar siempre es más barato que
  // decidir caso por caso cuándo hace falta.
  invalidarCacheOrganizaciones();
  return creada;
}

/** No está marcado "sólo superadmin" en el reparto de T6: un admin de la propia organización también puede renombrarla. */
export async function renombrarOrganizacion(actor: ActorGestion, organizationId: string, name: string) {
  await exigirPuedeAdministrar(actor, organizationId);

  const limpio = name.trim();
  if (!limpio) throw new GestionError('Falta el nombre.', 422);
  if (limpio.length > 200) throw new GestionError('El nombre es demasiado largo.', 422);

  return prisma.organization.update({ where: { id: organizationId }, data: { name: limpio } });
}

/** Superadmin únicamente (decisión de T6): dar de baja o reactivar una organización entera. */
export async function archivarOrganizacion(actor: ActorGestion, organizationId: string) {
  await exigirSuperadmin(actor);
  await obtenerOrganizacionOFallar(organizationId);

  const actualizada = await prisma.organization.update({
    where: { id: organizationId },
    data: { archivedAt: new Date() },
  });
  invalidarCacheOrganizaciones();
  return actualizada;
}

export async function desarchivarOrganizacion(actor: ActorGestion, organizationId: string) {
  await exigirSuperadmin(actor);
  await obtenerOrganizacionOFallar(organizationId);

  const actualizada = await prisma.organization.update({
    where: { id: organizationId },
    data: { archivedAt: null },
  });
  invalidarCacheOrganizaciones();
  return actualizada;
}

// ─────────────────────────────────────────────────────────────
// Dominios (superadmin únicamente — decisión de T6)
// ─────────────────────────────────────────────────────────────

/** Comodín de subdominio (`*.edu.ar`) o dominio exacto — mismo patrón que tenía `AuthorizedDomain` (M6, ya borrado en T1). */
const PATRON_DOMINIO = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function normalizarPatronDominio(pattern: string): string {
  const limpio = pattern.trim().toLowerCase().replace(/^@/, '');
  if (!PATRON_DOMINIO.test(limpio)) {
    throw new GestionError('Ese dominio no tiene un formato válido. Ejemplos: "escuela.edu.ar" o "*.edu.ar".', 422);
  }
  return limpio;
}

/**
 * Agregar un dominio a una CAMPUS une de inmediato a las cuentas personales
 * de confianza que ya matcheaban (decisión de T6) — salvo quien esté
 * excluido de ESTA sede. Un dominio de NETWORK no une a nadie solo (queda
 * para el picker, T4).
 */
export async function agregarDominio(
  actor: ActorGestion,
  organizationId: string,
  datos: { pattern: string; note?: string | null },
) {
  await exigirSuperadmin(actor);
  const org = await obtenerOrganizacionOFallar(organizationId);
  const pattern = normalizarPatronDominio(datos.pattern);

  let creado;
  try {
    creado = await prisma.organizationDomain.create({
      data: { organizationId, pattern, note: datos.note?.trim() || null },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new GestionError('Ese dominio ya está en uso por otra organización.', 409);
    }
    throw error;
  }

  if (org.kind === 'CAMPUS') {
    await unirPersonalesPorDominio(organizationId, pattern);
  }

  invalidarCacheOrganizaciones();
  return creado;
}

/**
 * Une a esta CAMPUS toda cuenta personal de confianza cuyo email caiga en
 * `pattern` — salvo la excluida de ESTA sede (T6: "la lista blanca y las
 * invitaciones son explícitas y ganan a la exclusión", pero un dominio NO es
 * ni lista blanca ni invitación, así que un excluido nunca vuelve por acá).
 */
async function unirPersonalesPorDominio(campusId: string, pattern: string): Promise<void> {
  const personales = await prisma.user.findMany({
    where: { organizationId: null, isDemo: false },
    select: { id: true, email: true, emailVerifiedAt: true },
  });

  const exactos = !pattern.startsWith('*.');
  const sufijo = exactos ? null : pattern.slice(1);

  const candidatos = personales.filter((persona) => {
    const dominio = emailDomain(persona.email);
    const coincide = exactos ? dominio === pattern : dominio.endsWith(sufijo!);
    if (!coincide) return false;
    return emailConfiable({ emailVerifiedAt: persona.emailVerifiedAt });
  });
  if (candidatos.length === 0) return;

  const excluidos = await prisma.organizationExclusion.findMany({
    where: { organizationId: campusId, email: { in: candidatos.map((c) => normalizeEmail(c.email)) } },
    select: { email: true },
  });
  const excluidosSet = new Set(excluidos.map((fila) => fila.email));

  const idsAUnir = candidatos
    .filter((persona) => !excluidosSet.has(normalizeEmail(persona.email)))
    .map((persona) => persona.id);
  if (idsAUnir.length === 0) return;

  await prisma.user.updateMany({ where: { id: { in: idsAUnir } }, data: { organizationId: campusId } });
}

export async function quitarDominio(actor: ActorGestion, organizationId: string, domainId: string) {
  await exigirSuperadmin(actor);
  await prisma.organizationDomain.deleteMany({ where: { id: domainId, organizationId } });
  invalidarCacheOrganizaciones();
}

export async function listarDominios(actor: ActorGestion, organizationId: string) {
  await exigirPuedeAdministrar(actor, organizationId);
  return prisma.organizationDomain.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  });
}

// ─────────────────────────────────────────────────────────────
// Lista blanca (campus; un admin de organización también puede — decisión de T6)
// ─────────────────────────────────────────────────────────────

export async function agregarEmailListaBlanca(
  actor: ActorGestion,
  organizationId: string,
  emailCrudo: string,
) {
  await exigirPuedeAdministrar(actor, organizationId);
  const org = await obtenerOrganizacionOFallar(organizationId);
  if (org.kind !== 'CAMPUS') throw new GestionError('La lista blanca es por sede, no por red.', 422);

  const email = normalizeEmail(emailCrudo);
  if (!email.includes('@')) throw new GestionError('Ese email no es válido.', 422);

  let creado;
  try {
    creado = await prisma.organizationAllowedEmail.create({
      data: { organizationId, email, createdById: actor.id },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new GestionError('Ese email ya está en la lista blanca de otra organización.', 409);
    }
    throw error;
  }

  // T6: agregar a la lista blanca borra la exclusión de ESTA sede (explícito
  // gana a la baja anterior) y une de inmediato a una cuenta personal de
  // confianza que ya tenga ese email.
  await prisma.organizationExclusion.deleteMany({ where: { organizationId, email } });

  const personal = await prisma.user.findFirst({
    where: { email, organizationId: null, isDemo: false },
    select: { id: true, emailVerifiedAt: true },
  });
  if (personal && emailConfiable({ emailVerifiedAt: personal.emailVerifiedAt })) {
    await prisma.user.update({ where: { id: personal.id }, data: { organizationId } });
  }

  invalidarCacheOrganizaciones();
  return creado;
}

export async function quitarEmailListaBlanca(actor: ActorGestion, organizationId: string, allowedEmailId: string) {
  await exigirPuedeAdministrar(actor, organizationId);
  await prisma.organizationAllowedEmail.deleteMany({ where: { id: allowedEmailId, organizationId } });
  invalidarCacheOrganizaciones();
}

export async function listarListaBlanca(actor: ActorGestion, organizationId: string) {
  await exigirPuedeAdministrar(actor, organizationId);
  return prisma.organizationAllowedEmail.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  });
}

// ─────────────────────────────────────────────────────────────
// Docentes: listar, dar de baja, mover
// ─────────────────────────────────────────────────────────────

export interface MiembroOrganizacion {
  id: string;
  name: string;
  email: string;
  /** `null` = nunca verificado (sólo posible con Resend configurado). */
  emailVerificationSource: 'GOOGLE' | 'EMAIL' | 'NO_PROVIDER' | null;
  /**
   * No hay columna de "se unió a esta organización el…" en el schema (T6 no
   * la agrega — hubiera sido otra migración fuera del alcance de la
   * exclusión); se usa la fecha de alta de la CUENTA como mejor aproximación
   * disponible. Para alguien que se unió mucho después de crear su cuenta
   * (invitación tardía, cambio de sede) esta fecha queda vieja — ver el
   * informe final de T6, "abierto".
   */
  createdAt: string;
  esAdmin: boolean;
}

export async function listarMiembros(actor: ActorGestion, organizationId: string): Promise<MiembroOrganizacion[]> {
  await exigirPuedeAdministrar(actor, organizationId);
  const org = await obtenerOrganizacionOFallar(organizationId);
  if (org.kind !== 'CAMPUS') throw new GestionError('Los docentes pertenecen a una sede, no a una red.', 422);

  const [miembros, admins] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, isDemo: false },
      select: { id: true, name: true, email: true, emailVerificationSource: true, createdAt: true },
      orderBy: { name: 'asc' },
    }),
    prisma.organizationAdmin.findMany({ where: { organizationId }, select: { userId: true } }),
  ]);
  const adminIds = new Set(admins.map((fila) => fila.userId));

  return miembros.map((miembro) => ({
    id: miembro.id,
    name: miembro.name,
    email: miembro.email,
    emailVerificationSource: miembro.emailVerificationSource,
    createdAt: miembro.createdAt.toISOString(),
    esAdmin: adminIds.has(miembro.id),
  }));
}

/**
 * Baja de un docente: pasa a ser una cuenta personal (pierde acceso a la
 * IA), se le borran TODAS sus filas de `OrganizationAdmin` (ya no administra
 * nada — decisión de T6) y queda una exclusión que bloquea volver a unirse
 * por dominio a la sede de la que se lo bajó. Sus recursos y su `TokenUsage`
 * histórico no se tocan (decisión del dueño, T5: "el costo queda donde se
 * pagó").
 */
export async function quitarMiembro(actor: ActorGestion, userId: string): Promise<void> {
  const miembro = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, organizationId: true, isDemo: true },
  });
  if (!miembro || miembro.isDemo) throw new GestionError('Ese docente no existe.', 404);
  if (!miembro.organizationId) throw new GestionError('Ese docente ya es una cuenta personal.', 409);

  await exigirPuedeAdministrar(actor, miembro.organizationId);
  const campusId = miembro.organizationId;
  const email = normalizeEmail(miembro.email);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { organizationId: null } }),
    prisma.organizationAdmin.deleteMany({ where: { userId } }),
    prisma.organizationExclusion.upsert({
      where: { organizationId_email: { organizationId: campusId, email } },
      create: { organizationId: campusId, email, createdById: actor.id },
      update: { createdAt: new Date(), createdById: actor.id },
    }),
  ]);

  invalidarCacheOrganizaciones();
}

/**
 * Mueve un docente de su sede actual a otra. Autoriza contra LAS DOS
 * (decisión de T6: "superadmin: cualquiera; admin de red: dentro de su
 * red") — un admin de sede sola sólo administra UNA organización, así que
 * nunca puede autorizar el origen Y el destino a la vez salvo que sean la
 * misma (no-op); un admin de red administra todas las sedes de su red, así
 * que puede mover entre cualquier par de ellas.
 */
export async function moverMiembro(actor: ActorGestion, userId: string, destinoCampusId: string): Promise<void> {
  const miembro = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, organizationId: true, isDemo: true },
  });
  if (!miembro || miembro.isDemo) throw new GestionError('Ese docente no existe.', 404);
  if (!miembro.organizationId) throw new GestionError('Ese docente es una cuenta personal, no tiene sede.', 409);

  const destino = await prisma.organization.findUnique({ where: { id: destinoCampusId } });
  if (!destino || destino.kind !== 'CAMPUS') throw new GestionError('Esa sede no existe.', 404);
  if (destino.archivedAt !== null) throw new GestionError('Esa sede está archivada.', 409);

  await exigirPuedeAdministrar(actor, miembro.organizationId);
  await exigirPuedeAdministrar(actor, destinoCampusId);

  if (miembro.organizationId === destinoCampusId) return;

  // El historial de TokenUsage ya frenado (T5, "costo congelado") no se toca
  // acá — sólo se mueve la sede ACTUAL del docente.
  await prisma.user.update({ where: { id: userId }, data: { organizationId: destinoCampusId } });
}

// ─────────────────────────────────────────────────────────────
// Admins de organización
// ─────────────────────────────────────────────────────────────

async function targetPerteneceAOrganizacion(targetUserId: string, organizationId: string): Promise<boolean> {
  const [org, target] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { kind: true } }),
    prisma.user.findUnique({
      where: { id: targetUserId },
      select: { organizationId: true, organization: { select: { parentId: true } } },
    }),
  ]);
  if (!org || !target) return false;

  if (org.kind === 'CAMPUS') return target.organizationId === organizationId;
  // NETWORK: el target tiene que pertenecer a una CAMPUS hija de esta red.
  return target.organization?.parentId === organizationId;
}

export async function promoverAdmin(actor: ActorGestion, organizationId: string, targetUserId: string) {
  await exigirPuedeAdministrar(actor, organizationId);

  const pertenece = await targetPerteneceAOrganizacion(targetUserId, organizationId);
  if (!pertenece) {
    throw new GestionError('Ese docente no pertenece a esta organización.', 422);
  }

  await prisma.organizationAdmin.upsert({
    where: { userId_organizationId: { userId: targetUserId, organizationId } },
    create: { userId: targetUserId, organizationId, createdById: actor.id },
    update: {},
  });
}

/**
 * "Un admin de organización no puede sacarse a sí mismo si es el último
 * admin de la suya; el superadmin sí puede" (decisión de T6) — evita que una
 * organización se quede sin nadie que la administre por accidente, pero
 * nunca le ata las manos al superadmin.
 */
export async function degradarAdmin(actor: ActorGestion, organizationId: string, targetUserId: string) {
  await exigirPuedeAdministrar(actor, organizationId);

  if (targetUserId === actor.id) {
    const alcance = await alcanceDeAdmin(actor);
    if (!alcance.esSuperadmin) {
      const totalAdmins = await prisma.organizationAdmin.count({ where: { organizationId } });
      if (totalAdmins <= 1) {
        throw new GestionError('Sos el único admin de esta organización. Nombrá a otro antes de sacarte.', 409);
      }
    }
  }

  await prisma.organizationAdmin.deleteMany({ where: { userId: targetUserId, organizationId } });
}

// ─────────────────────────────────────────────────────────────
// Listado / detalle para /admin/organizaciones (T6) y /org (T8)
// ─────────────────────────────────────────────────────────────

export interface OrganizacionResumen {
  id: string;
  name: string;
  kind: OrganizationKind;
  parentId: string | null;
  archivada: boolean;
  miembros: number;
  admins: number;
}

async function serializarResumen(org: {
  id: string;
  name: string;
  kind: OrganizationKind;
  parentId: string | null;
  archivedAt: Date | null;
}): Promise<OrganizacionResumen> {
  const [miembros, admins] = await Promise.all([
    org.kind === 'CAMPUS' ? prisma.user.count({ where: { organizationId: org.id, isDemo: false } }) : 0,
    prisma.organizationAdmin.count({ where: { organizationId: org.id } }),
  ]);
  return {
    id: org.id,
    name: org.name,
    kind: org.kind,
    parentId: org.parentId,
    archivada: org.archivedAt !== null,
    miembros,
    admins,
  };
}

/** El árbol completo para `/admin/organizaciones` — sólo superadmin (la página es superadmin-only). */
export async function listarOrganizacionesSuperadmin(actor: ActorGestion): Promise<{
  redes: Array<OrganizacionResumen & { sedes: OrganizacionResumen[] }>;
  standalone: OrganizacionResumen[];
}> {
  await exigirSuperadmin(actor);

  const todas = await prisma.organization.findMany({ orderBy: { name: 'asc' } });
  const resumenes = await Promise.all(todas.map(serializarResumen));

  const redes = resumenes
    .filter((r) => r.kind === 'NETWORK')
    .map((red) => ({
      ...red,
      sedes: resumenes.filter((r) => r.kind === 'CAMPUS' && r.parentId === red.id),
    }));
  const standalone = resumenes.filter((r) => r.kind === 'CAMPUS' && r.parentId === null);

  return { redes, standalone };
}

export interface AdminDeOrganizacion {
  id: string;
  name: string;
  email: string;
}

export interface DetalleOrganizacion extends OrganizacionResumen {
  dominios: Array<{ id: string; pattern: string; note: string | null }>;
  listaBlanca: Array<{ id: string; email: string }>;
  padre: { id: string; name: string } | null;
  sedes: OrganizacionResumen[];
  adminsLista: AdminDeOrganizacion[];
}

/** El detalle para `/admin/organizaciones/[id]` (T6) — reusable por `/org/[id]` (T8) porque autoriza con `puedeAdministrar`. */
export async function obtenerDetalleOrganizacion(
  actor: ActorGestion,
  organizationId: string,
): Promise<DetalleOrganizacion> {
  await exigirPuedeAdministrar(actor, organizationId);
  const org = await obtenerOrganizacionOFallar(organizationId);

  const [resumen, dominios, listaBlanca, padre, sedes, adminsFilas] = await Promise.all([
    serializarResumen(org),
    prisma.organizationDomain.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, pattern: true, note: true },
    }),
    prisma.organizationAllowedEmail.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    }),
    org.parentId
      ? prisma.organization.findUnique({ where: { id: org.parentId }, select: { id: true, name: true } })
      : Promise.resolve(null),
    org.kind === 'NETWORK'
      ? prisma.organization.findMany({ where: { parentId: organizationId }, orderBy: { name: 'asc' } })
      : Promise.resolve([]),
    prisma.organizationAdmin.findMany({
      where: { organizationId },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ]);

  const sedesResumen = await Promise.all(sedes.map(serializarResumen));
  const adminsLista = adminsFilas.map((fila) => fila.user);

  return { ...resumen, dominios, listaBlanca, padre, sedes: sedesResumen, adminsLista };
}
