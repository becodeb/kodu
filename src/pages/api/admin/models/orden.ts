import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';
import { invalidarCatalogo } from '../../../../lib/ai/catalogo.ts';
import { serializarMotor, type MotorAdmin } from '../../../../lib/admin/modelos.ts';

/**
 * PATCH /api/admin/models/orden — reordena el catálogo entero.
 *
 * Recibe el array COMPLETO de ids en el orden nuevo, no un delta (design.md
 * "El models list"): tanto el arrastre con mouse como las flechas de teclado
 * en `ModelosPanel.tsx` escriben acá con el mismo formato, así que una
 * edición concurrente queda en "gana el último que escribe" y no en una
 * secuencia corrupta.
 */

const ordenSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1, 'La lista de ids no puede estar vacía'),
});

export const PATCH: APIRoute = async ({ request }) => {
  const parsed = ordenSchema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const { ids } = parsed.data;

  const existentes = await prisma.aiModel.findMany({ select: { id: true } });
  const idsExistentes = new Set(existentes.map((fila) => fila.id));
  const idsPedidos = new Set(ids);

  if (idsExistentes.size !== idsPedidos.size || [...idsExistentes].some((id) => !idsPedidos.has(id))) {
    return fail('La lista tiene que incluir exactamente todos los motores, sin repetir ninguno.', 422);
  }

  await prisma.$transaction(ids.map((id, indice) => prisma.aiModel.update({ where: { id }, data: { sortOrder: indice } })));
  invalidarCatalogo();

  const filas = await prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' } });
  const motores: MotorAdmin[] = filas.map(serializarMotor);
  return ok({ motores });
};
