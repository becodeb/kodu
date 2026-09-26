import type { APIRoute } from 'astro';
import { z } from 'zod';
import { findProjectForActor } from '../../../lib/projects.ts';
import { marcarChequeosPosteriores, reclamarChequeosPosteriores } from '../../../lib/ai/post-checks-db.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/post-checks — T5 (odd/tasks/generacion-simple-y-reanudable.md):
 * el endpoint chico que necesita el marcador por turno de "¿ya corrieron el
 * self-test/corrección/verificador del navegador sobre este HTML?"
 * (`ChatMessage.postChecksAt`/`postChecksClaimedAt`). Dos acciones en el
 * mismo archivo, mismas puertas de propiedad (`findProjectForActor`) que
 * cualquier otra ruta del proyecto:
 *
 *  - `claim`: una pestaña que acaba de abrir el proyecto (o que terminó de
 *    reanudar un turno en curso) encontró uno sin chequear y pide correr el
 *    pipeline. Atómico del lado del servidor (`reclamarChequeosPosteriores`):
 *    si dos pestañas abren el mismo proyecto a la vez, sólo una se queda con
 *    el reclamo.
 *  - `complete`: la pestaña que reclamó avisa que terminó (self-test +
 *    corrección; el verificador es best-effort y no bloquea esto, mismo
 *    criterio que ya usa un turno normal con `iniciarVerificacion`).
 *
 * Discreto a propósito, igual que `/api/chat/autocorreccion`/`verificar`:
 * esto es contabilidad interna, nunca algo que el docente pidió — un
 * `claimed`/`marked` en `false` no es un error, es "ya no correspondía" (otra
 * pestaña se adelantó, o el HTML dejó de coincidir).
 */

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), projectId: z.string().min(1), messageId: z.string().min(1) }),
  z.object({
    action: z.literal('complete'),
    projectId: z.string().min(1),
    messageId: z.string().min(1),
    fingerprint: z.string().min(1).max(32),
  }),
]);

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos.', 422);

  const project = await findProjectForActor(parsed.data.projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  if (parsed.data.action === 'claim') {
    const claimed = await reclamarChequeosPosteriores(project.id, parsed.data.messageId);
    return ok({ claimed });
  }

  const marked = await marcarChequeosPosteriores({
    projectId: project.id,
    messageId: parsed.data.messageId,
    fingerprint: parsed.data.fingerprint,
  });
  return ok({ marked });
};
