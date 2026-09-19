import type { APIRoute } from 'astro';
import { prisma } from '../../../../lib/db.ts';
import { ok } from '../../../../lib/http.ts';

/**
 * `/api/admin/demo/recursos` — los recursos publicados por la cuenta de
 * demo (design.md §8; specs/demo-mode/spec.md — "Demo-created gallery
 * resources are marked and purgeable").
 *
 * `GET` existe para que el panel pueda mostrar CUÁNTOS se van a borrar antes
 * de que el admin confirme — el purgado es irreversible, así que lo que va a
 * pasar tiene que quedar inequívoco antes del click de confirmación.
 */
export const GET: APIRoute = async () => {
  const cantidad = await prisma.project.count({ where: { createdByDemo: true } });
  return ok({ cantidad });
};

/**
 * `DELETE` — borra TODOS los recursos con `createdByDemo = true` y nada
 * más: el `where` nunca cambia, así que un recurso de un docente real no
 * puede quedar adentro por error. Hilos y adjuntos caen en cascada
 * (`Project` → `ChatThread`/`ProjectAsset` ya son `onDelete: Cascade`);
 * `TokenUsage.projectId` es `onDelete: SetNull`, así que el consumo
 * histórico de esos turnos no desaparece con el recurso.
 */
export const DELETE: APIRoute = async () => {
  const resultado = await prisma.project.deleteMany({ where: { createdByDemo: true } });
  return ok({ cantidadBorrada: resultado.count });
};
