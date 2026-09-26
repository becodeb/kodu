import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../../lib/db.ts';
import { findProjectForActor } from '../../../../lib/projects.ts';
import { checklistActual } from '../../../../lib/ai/checklist-db.ts';
import { pendienteChequeosPosteriores } from '../../../../lib/ai/post-checks-db.ts';
import { fail, ok, readBody } from '../../../../lib/http.ts';

const schema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
});

/**
 * POST /api/projects/:id/threads — abre un hilo nuevo.
 *
 * Sirve para arrancar una conversación limpia sin perder el código: el HTML
 * vive en el proyecto, no en el hilo (SPEC §5.1).
 */
export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) return fail('Título de hilo inválido.', 422);

  const count = await prisma.chatThread.count({ where: { projectId: project.id } });

  const thread = await prisma.chatThread.create({
    data: {
      projectId: project.id,
      title: parsed.data.title ?? `Conversación ${count + 1}`,
    },
    select: { id: true, title: true, createdAt: true },
  });

  return ok({ thread });
};

/**
 * GET /api/projects/:id/threads          → lista de hilos
 * GET /api/projects/:id/threads?threadId= → mensajes de ese hilo
 */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const user = locals.user!;
  const project = await findProjectForActor(params.id!, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const threadId = url.searchParams.get('threadId');

  if (!threadId) {
    const threads = await prisma.chatThread.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true },
    });
    return ok({ threads });
  }

  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, projectId: project.id },
    select: { id: true },
  });
  if (!thread) return fail('El hilo de conversación no existe.', 404);

  // T18 (round 4, "checklist del docente"): este endpoint también es el que
  // usa Workspace.tsx para "retomar un turno que quedó corriendo en el
  // servidor" (recarga de página a mitad de un turno) — si ese turno era de
  // creación, terminó guardando un checklist nuevo que la página nunca vio
  // (llegó por el SSE que esa pestaña se perdió). Del ámbito del PROYECTO,
  // no de este hilo (mismo alcance que `currentHtml` acá abajo).
  const [messages, checklist, pendingPostChecks] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        content: true,
        attachments: true,
        createdAt: true,
        // T4: sólo si tiene instantánea y si ya se deshizo — el `select`
        // anidado trae nada más que el `id` de la instantánea (nunca su
        // `html`, que puede pesar lo que pesa el recurso entero) sólo para
        // poder contestar "¿existe?".
        undoneAt: true,
        snapshot: { select: { id: true } },
        // T9 ("Varias versiones al crear un recurso"): sólo el mensaje más
        // nuevo del proyecto puede tener filas
        // acá (stream.ts las borra al empezar cualquier turno posterior), así
        // que no hace falta un caso especial para "es el más nuevo" — la
        // tabla ya lo garantiza sola. Nunca el `html` de cada versión (sólo
        // viaja al elegir, por POST /api/projects/[id]/variant).
        chosenVariantIndex: true,
        variants: { select: { index: true }, orderBy: { index: 'asc' } },
      },
    }),
    checklistActual(project.id),
    // T5: este mismo pedido es el que usa Workspace.tsx para "retomar un
    // turno que quedó corriendo" — si ESE turno era el que cambió el HTML y
    // nunca corrió el pipeline del navegador, la pestaña que lo reanuda
    // necesita saberlo apenas termina de esperar, sin recargar de nuevo.
    pendienteChequeosPosteriores(project.id),
  ]);

  // Se devuelve tambien el HTML porque el editor usa este endpoint para
  // retomar un turno que quedo corriendo en el servidor: sin el codigo, el
  // docente veria la respuesta nueva pero el visor seguiria con la version
  // vieja hasta recargar de nuevo.
  return ok({
    currentHtml: project.currentHtml,
    checklist,
    pendingPostChecks,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      attachments: message.attachments ? (JSON.parse(message.attachments) as string[]) : [],
      createdAt: message.createdAt.getTime(),
      undoneAt: message.undoneAt ? message.undoneAt.getTime() : null,
      // T4: si HOY se puede pedir deshacer este mensaje puntual (tiene
      // instantánea y todavía no se deshizo). El cliente decide, con esto,
      // cuál es "el más nuevo deshacible" — acá no hace falta saber cuál es.
      canUndo: message.snapshot !== null && message.undoneAt === null,
      // T9: ausente (no `[]`) cuando este mensaje no es un turno de
      // versiones, para que el cliente lo trate igual que cualquier turno
      // de antes de T9.
      ...(message.variants.length > 0
        ? {
            variants: message.variants.map((variant) => ({ index: variant.index })),
            chosenVariant: message.chosenVariantIndex ?? 1,
          }
        : {}),
    })),
  });
};
