import type { APIRoute } from 'astro';
import { z } from 'zod';
import { fail, ok, readBody } from '../../../../../lib/http.ts';
import { requireUser } from '../../../../../lib/auth/guards.ts';
import {
  archivarOrganizacion,
  desarchivarOrganizacion,
  obtenerDetalleOrganizacion,
  renombrarOrganizacion,
  GestionError,
} from '../../../../../lib/orgs/gestion.ts';

/**
 * `/api/admin/organizaciones/:id` — detalle, renombre y archivado
 * (odd/tasks/organizaciones.md T6).
 */

const actualizarSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});

export const GET: APIRoute = async ({ params, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  try {
    const organizacion = await obtenerDetalleOrganizacion(actor, params.id!);
    return ok({ organizacion });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const actor = requireUser(locals);
  if (actor instanceof Response) return actor;

  const parsed = actualizarSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  const datos = parsed.data;

  if (datos.name === undefined && datos.archived === undefined) {
    return fail('No hay nada para actualizar.', 422);
  }

  try {
    if (datos.name !== undefined) {
      await renombrarOrganizacion(actor, params.id!, datos.name);
    }
    if (datos.archived === true) {
      await archivarOrganizacion(actor, params.id!);
    } else if (datos.archived === false) {
      await desarchivarOrganizacion(actor, params.id!);
    }

    const organizacion = await obtenerDetalleOrganizacion(actor, params.id!);
    return ok({ organizacion });
  } catch (error) {
    if (error instanceof GestionError) return fail(error.message, error.status);
    throw error;
  }
};
