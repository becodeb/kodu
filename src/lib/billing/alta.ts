import { prisma } from '../db.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import { billingNow, getAdminEmails, hasResendApiKey } from '../env.ts';
import { normalizeEmail, emailDomain } from '../auth/domains.ts';
import { enviarEmail } from '../email/resend.ts';
import { invalidarCacheOrganizaciones } from '../orgs/resolucion.ts';
import { normalizarDominio, isPublicEmailDomain } from './dominios.ts';
import { bandForStudents } from './bandas.ts';
import type { ResultadoAccion } from './aplicar.ts';
import type { OrganizationKind } from '../../generated/prisma/client.ts';

/**
 * odd/tasks/planes-y-cobros.md (T5): alta de instituciones por cuenta propia
 * ("Probá 30 días gratis") — el ÚNICO lugar que crea una `Organization` SIN
 * ser el superadmin (`gestion.ts#crearOrganizacion` sigue siendo
 * "sólo superadmin", decisión del dueño de organizaciones.md que esta tarea
 * no reabre). Nunca reusa `crearOrganizacion`/`agregarDominio` a propósito:
 * esas funciones exigen `exigirSuperadmin`, y acá el actor es el propio
 * docente que se está dando de alta.
 *
 * Dominio self-serve DISTINTO del de `gestion.ts`: nunca acepta un comodín
 * (`*.edu.ar`) — dejar que cualquiera que escriba `*.edu.ar` en este
 * formulario reclame TODO un TLD compartido sería un agujero de seguridad
 * que el alta a mano del superadmin no tiene (ahí el dueño revisa a ojo).
 */

/** Sin comodín — a propósito, ver el comentario de arriba. */
const PATRON_DOMINIO_PROPIO = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export type MotivoRechazoAlta =
  | 'YA_EN_ORGANIZACION'
  | 'DOMINIO_PUBLICO'
  | 'DOMINIO_INVALIDO'
  | 'DOMINIO_EN_USO'
  | 'HABLEMOS'
  | 'DATOS_INVALIDOS';

export interface CampusInput {
  name: string;
  /** Opcional: una sede puede no tener dominio propio (se suma por invitación/lista blanca). */
  domain?: string | null;
}

export interface DatosAltaInstitucion {
  institutionName: string;
  kind: OrganizationKind;
  /** Matrícula declarada (total de la red, si es una red — decisión del dueño). */
  declaredStudents: number;
  /** Dominios EXTRA además del propio del creador (que se agrega solo, VERIFIED). */
  extraDomains: string[];
  /** Sólo para `kind === 'NETWORK'`: al menos una sede. */
  campuses: CampusInput[];
}

export interface AltaInstitucionResultado {
  organizationId: string;
  /** `null` cuando `BillingSettings.trialEnabled` está apagado (T11): el
   *  alta arranca en `PENDING_PAYMENT`, sin prueba, en vez de `TRIAL`. */
  trialEndsAt: Date | null;
  pendingDomains: string[];
  /** `true` si el creador tenía un plan Individual pago y quedó con baja al fin del período. */
  individualSubCancelada: boolean;
}

function limpiarNombre(nombre: string, etiqueta: string): string {
  const limpio = nombre.trim();
  if (!limpio) throw new RechazoAlta('DATOS_INVALIDOS', `Falta ${etiqueta}.`);
  if (limpio.length > 200) throw new RechazoAlta('DATOS_INVALIDOS', `${etiqueta} es demasiado larga.`);
  return limpio;
}

/** Normaliza y valida UN dominio propio (sin comodín, no público). Tira `RechazoAlta`. */
function validarDominioPropio(crudo: string): string {
  const dominio = normalizarDominio(crudo);
  if (!PATRON_DOMINIO_PROPIO.test(dominio)) {
    throw new RechazoAlta('DOMINIO_INVALIDO', `"${crudo}" no es un dominio válido. Ejemplo: "escuela.edu.ar".`);
  }
  if (isPublicEmailDomain(dominio)) {
    throw new RechazoAlta(
      'DOMINIO_PUBLICO',
      `"${dominio}" es un correo público — las instituciones necesitan un dominio propio. Escribinos si es un caso particular.`,
    );
  }
  return dominio;
}

export class RechazoAlta extends Error {
  motivo: MotivoRechazoAlta;
  constructor(motivo: MotivoRechazoAlta, message: string) {
    super(message);
    this.motivo = motivo;
    this.name = 'RechazoAlta';
  }
}

async function settings() {
  return prisma.billingSettings.findUniqueOrThrow({ where: { id: 1 } });
}

/**
 * Alta atómica: organización raíz (+ sedes de una red), dominios, licencia
 * TRIAL y admin. Devuelve `ResultadoAccion` (mismo vocabulario que
 * `aplicar.ts`) para que el endpoint traduzca el mismo tipo de error que ya
 * conoce el cliente de checkout.
 */
export async function altaInstitucion(
  actor: { id: string; email: string },
  datos: DatosAltaInstitucion,
): Promise<ResultadoAccion<AltaInstitucionResultado>> {
  try {
    const fila = await prisma.user.findUnique({
      where: { id: actor.id },
      select: { organizationId: true, isDemo: true },
    });
    if (!fila || fila.isDemo) {
      return { ok: false, status: 403, message: 'La cuenta de demo no puede dar de alta una institución.' };
    }
    if (fila.organizationId !== null) {
      const org = await prisma.organization.findUnique({
        where: { id: fila.organizationId },
        select: { name: true },
      });
      return {
        ok: false,
        status: 409,
        message: `Tu cuenta ya pertenece a ${org?.name ?? 'una organización'}.`,
        reason: 'YA_EN_ORGANIZACION',
      };
    }

    const institutionName = limpiarNombre(datos.institutionName, 'el nombre de la institución');
    if (datos.kind !== 'CAMPUS' && datos.kind !== 'NETWORK') {
      return { ok: false, status: 422, message: 'Elegí si es un colegio o una red de colegios.' };
    }

    const dominioCreador = validarDominioPropio(emailDomain(actor.email) || actor.email);

    const extrasNormalizados = datos.extraDomains
      .map((d) => d.trim())
      .filter(Boolean)
      .map(validarDominioPropio);

    const campuses =
      datos.kind === 'NETWORK'
        ? datos.campuses.map((c) => ({
            name: limpiarNombre(c.name, 'el nombre de la sede'),
            domain: c.domain && c.domain.trim() ? validarDominioPropio(c.domain) : null,
          }))
        : [];
    if (datos.kind === 'NETWORK' && campuses.length === 0) {
      return { ok: false, status: 422, message: 'Una red necesita al menos una sede.' };
    }

    // Todos los dominios de este alta (propio + extras + sedes) tienen que
    // ser distintos ENTRE SÍ, además de no estar ya en uso por otra
    // organización (chequeado más abajo, en la transacción).
    const todosLosDominios = [dominioCreador, ...extrasNormalizados, ...campuses.map((c) => c.domain).filter((d): d is string => !!d)];
    const repetido = todosLosDominios.find((d, i) => todosLosDominios.indexOf(d) !== i);
    if (repetido) {
      return { ok: false, status: 422, message: `El dominio "${repetido}" está repetido en el formulario.` };
    }

    const cfg = await settings();
    const banda = bandForStudents(datos.declaredStudents, cfg.hablemosThresholdStudents);
    if (banda.kind === 'invalid') {
      return { ok: false, status: 422, message: `La matrícula no es válida: ${banda.reason}.` };
    }
    if (banda.kind === 'hablemos') {
      return {
        ok: false,
        status: 422,
        message: 'Tu matrícula supera nuestras bandas con precio fijo — escribinos y lo vemos.',
        reason: 'HABLEMOS',
      };
    }

    const existentes = await prisma.organizationDomain.findMany({
      where: { pattern: { in: todosLosDominios } },
      select: { pattern: true },
    });
    if (existentes.length > 0) {
      return {
        ok: false,
        status: 409,
        message: 'Ese dominio ya pertenece a otra institución. Escribinos si es un error.',
        reason: 'DOMINIO_EN_USO',
      };
    }

    const existenteIndividual = await prisma.individualSubscription.findUnique({ where: { userId: actor.id } });
    const hayQueCancelarIndividual = existenteIndividual !== null && existenteIndividual.status === 'ACTIVE';

    const now = billingNow();
    // odd/tasks/planes-y-cobros.md (T11, decisión del dueño): la prueba
    // institucional es un interruptor del superadmin, OFF por default
    // ("todavía tenemos 0 clientes"). Con el interruptor apagado el alta
    // sigue creando la institución, los dominios y el admin — pero SIN
    // prueba: arranca en `PENDING_PAYMENT` (bloquea la IA con un motivo
    // explícito, nunca una prueba "ya vencida" de mentira) en vez de
    // `TRIAL`. El superadmin puede seguir dándole una prueba a mano desde
    // `/admin/altas` (`extenderPrueba`, revision-acciones.ts).
    const trialEndsAt = cfg.trialEnabled ? new Date(now.getTime() + cfg.trialDays * 86_400_000) : null;

    const resultado = await prisma.$transaction(async (tx) => {
      const raiz = await tx.organization.create({
        data: { name: institutionName, kind: datos.kind },
      });

      await tx.organizationDomain.create({
        data: { organizationId: raiz.id, pattern: dominioCreador, status: 'VERIFIED' },
      });
      for (const extra of extrasNormalizados) {
        await tx.organizationDomain.create({
          data: { organizationId: raiz.id, pattern: extra, status: 'PENDING' },
        });
      }

      let primeraSedeId: string | null = null;
      if (datos.kind === 'NETWORK') {
        for (const campus of campuses) {
          const sede = await tx.organization.create({
            data: { name: campus.name, kind: 'CAMPUS', parentId: raiz.id },
          });
          if (primeraSedeId === null) primeraSedeId = sede.id;
          if (campus.domain) {
            await tx.organizationDomain.create({
              data: { organizationId: sede.id, pattern: campus.domain, status: 'PENDING' },
            });
          }
        }
      }

      await tx.organizationLicense.create({
        data: {
          organizationId: raiz.id,
          status: cfg.trialEnabled ? 'TRIAL' : 'PENDING_PAYMENT',
          declaredStudents: datos.declaredStudents,
          bandKey: banda.key,
          trialEndsAt,
          createdVia: 'SELF_SERVE',
        },
      });

      await tx.organizationAdmin.create({ data: { userId: actor.id, organizationId: raiz.id } });

      // El creador queda como DOCENTE de la primera sede (una red todavía no
      // tiene a nadie para elegir sede — T4/organizaciones.md: "el admin de
      // la red puede cambiarla después"). Un colegio standalone es su propia
      // sede.
      const campusDeMembresia = datos.kind === 'NETWORK' ? primeraSedeId! : raiz.id;
      await tx.user.update({ where: { id: actor.id }, data: { organizationId: campusDeMembresia } });

      if (hayQueCancelarIndividual) {
        await tx.individualSubscription.update({
          where: { id: existenteIndividual!.id },
          data: { cancelAtPeriodEnd: true },
        });
      }

      return raiz;
    });

    invalidarCacheOrganizaciones();
    avisarSuperadmin(institutionName, datos.declaredStudents, [dominioCreador, ...extrasNormalizados]).catch(() => {});

    return {
      ok: true,
      data: {
        organizationId: resultado.id,
        trialEndsAt,
        pendingDomains: extrasNormalizados,
        individualSubCancelada: hayQueCancelarIndividual,
      },
    };
  } catch (error) {
    if (error instanceof RechazoAlta) {
      const status = error.motivo === 'DOMINIO_EN_USO' || error.motivo === 'YA_EN_ORGANIZACION' ? 409 : 422;
      return { ok: false, status, message: error.message, reason: error.motivo };
    }
    // Carrera: dos altas con el mismo dominio llegan juntas a la transacción
    // (el chequeo de arriba ya no alcanza) — el índice único de
    // OrganizationDomain.pattern es la última línea de defensa.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return {
        ok: false,
        status: 409,
        message: 'Ese dominio ya pertenece a otra institución. Escribinos si es un error.',
        reason: 'DOMINIO_EN_USO',
      };
    }
    throw error;
  }
}

/**
 * Aviso al superadmin por mail (best-effort, nunca bloquea el alta — se
 * llama con `.catch(() => {})` desde `altaInstitucion`). Sin `RESEND_API_KEY`
 * no manda nada; la cola de revisión (`revision.ts`) sigue siendo la fuente
 * de verdad, esto es sólo una notificación.
 */
async function avisarSuperadmin(institutionName: string, declaredStudents: number, dominios: string[]): Promise<void> {
  if (!hasResendApiKey()) return;
  const destinatarios = getAdminEmails();
  if (destinatarios.length === 0) return;

  const texto = `Nueva institución en prueba: ${institutionName}, ${declaredStudents} alumnos, dominios: ${dominios.join(', ')}.`;
  for (const destinatario of destinatarios) {
    await enviarEmail({
      to: destinatario,
      subject: `Kodu — nueva institución en prueba: ${institutionName}`,
      text: texto,
      html: `<p>${texto}</p>`,
    });
  }
}

export interface DatosLead {
  institutionName: string;
  contactName: string;
  contactEmail: string;
  phone?: string | null;
  declaredStudents?: number | null;
  message?: string | null;
}

/**
 * El contacto "Hablemos" (matrícula por encima del umbral, o el formulario de
 * contacto simple) — nunca crea una organización, sólo guarda la fila para
 * que el superadmin la contacte a mano (T7).
 */
export async function crearLeadInstitucional(datos: DatosLead): Promise<{ id: string }> {
  const institutionName = limpiarNombre(datos.institutionName, 'el nombre de la institución');
  const contactName = limpiarNombre(datos.contactName, 'tu nombre');
  const contactEmail = normalizeEmail(datos.contactEmail);
  if (!contactEmail.includes('@')) throw new RechazoAlta('DATOS_INVALIDOS', 'Ese email no es válido.');

  const lead = await prisma.institutionLead.create({
    data: {
      institutionName,
      contactName,
      contactEmail,
      phone: datos.phone?.trim() || null,
      declaredStudents: datos.declaredStudents ?? null,
      message: datos.message?.trim() || null,
    },
    select: { id: true },
  });

  if (hasResendApiKey()) {
    const destinatarios = getAdminEmails();
    const detalleMatricula = datos.declaredStudents ? `${datos.declaredStudents} alumnos` : 'matrícula sin declarar';
    const texto = `Nuevo contacto "Hablemos": ${institutionName} (${detalleMatricula}), ${contactName} <${contactEmail}>.`;
    for (const destinatario of destinatarios) {
      await enviarEmail({
        to: destinatario,
        subject: `Kodu — contacto de institución: ${institutionName}`,
        text: texto,
        html: `<p>${texto}</p>`,
      }).catch(() => {});
    }
  }

  return lead;
}
