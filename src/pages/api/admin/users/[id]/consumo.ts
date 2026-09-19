import type { APIRoute } from 'astro';
import { fail, ok } from '../../../../../lib/http.ts';
import { prisma } from '../../../../../lib/db.ts';
import { consumoDiarioDeUsuario, consumoPorUsuario } from '../../../../../lib/ai/usage.ts';

/**
 * GET /api/admin/users/:id/consumo — la data cruda de los dos gráficos del
 * detalle de usuario (design.md — "The user detail view").
 *
 * `src/pages/admin/usuarios/[id].astro` llama directamente a
 * `consumoDiarioDeUsuario`/`consumoPorUsuario` en su frontmatter (mismo
 * patrón que `motores.astro` usa con `prisma` — no hay auto-fetch a la
 * propia API durante el render del servidor en este repo). Esta ruta existe
 * igual, con la misma forma exacta que pide el contrato de design.md, para
 * quedar disponible como API standalone.
 *
 * Mismo borde `Decimal` que `motores.astro`/`[id].ts` de motores (M2/M3):
 * todo sale ya convertido a `string`/`number` antes de salir de acá.
 */
export const GET: APIRoute = async ({ params }) => {
  const existe = await prisma.user.findUnique({ where: { id: params.id! }, select: { id: true } });
  if (!existe) return fail('Ese usuario no existe.', 404);

  const [periodo, porModeloRaw] = await Promise.all([
    consumoDiarioDeUsuario(params.id!, 30),
    consumoPorUsuario(params.id!),
  ]);

  return ok({
    porDia: periodo.porDia,
    total: { tokens: periodo.tokens, costUsd: periodo.costUsd?.toString() ?? null },
    porModelo: porModeloRaw.map((fila) => ({
      aiModelId: fila.aiModelId,
      etiqueta: fila.etiqueta,
      tokens: fila.tokens,
      costUsd: fila.costUsd?.toString() ?? null,
      historico: fila.historico,
    })),
  });
};
