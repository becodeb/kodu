import type { APIRoute } from 'astro';
import { z } from 'zod';
import { Prisma } from '../../../../generated/prisma/client.ts';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { invalidarDominios } from '../../../../lib/auth/domains.ts';
import { listarDominiosAdmin } from '../../../../lib/admin/dominios.ts';

/**
 * `/api/admin/domains` — listado y alta de la lista blanca de dominios que
 * habilitan el uso de la IA (design.md §10; specs/ai-access-control/spec.md
 * — "Admin adds a domain without redeploy").
 *
 * La autenticación y la frescura de la identidad ya las exige el middleware
 * (`requireAdmin` en GET, `requireFreshAdmin` en POST — ver
 * `src/middleware.ts`); acá sólo queda la lógica de negocio.
 */

/**
 * Comodín de subdominio (`*.edu.ar`) o dominio exacto (`rededucativa.edu.ar`).
 * Sin "@", en minúsculas — el mismo formato que `domains.ts` espera guardado.
 */
const PATRON_DOMINIO = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const crearDominioSchema = z.object({
  pattern: z
    .string()
    .trim()
    .toLowerCase()
    .transform((valor) => valor.replace(/^@/, ''))
    .refine((valor) => PATRON_DOMINIO.test(valor), {
      message: 'Ese dominio no tiene un formato válido. Ejemplos: "escuela.edu.ar" o "*.edu.ar".',
    }),
  note: z.string().trim().max(300).nullable().optional(),
});

/** GET /api/admin/domains — el listado completo, ordenado por fecha de alta. */
export const GET: APIRoute = async () => {
  const dominios = await listarDominiosAdmin();
  return ok({ dominios });
};

/** POST /api/admin/domains — agrega un dominio nuevo a la lista blanca. */
export const POST: APIRoute = async ({ request }) => {
  const parsed = crearDominioSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const { pattern, note } = parsed.data;

  try {
    await prisma.authorizedDomain.create({ data: { pattern, note: note ?? null } });
    invalidarDominios();
    return ok({ dominios: await listarDominiosAdmin() });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return fail('Ese dominio ya está en la lista.', 409);
    }
    throw error;
  }
};
