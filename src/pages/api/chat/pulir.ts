import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor } from '../../../lib/projects.ts';
import { fingerprintHtml } from '../../../lib/ai/fingerprint.ts';
import { motorParaPresetYEsfuerzo } from '../../../lib/ai/catalogo.ts';
import { pulirVisualmente } from '../../../lib/ai/pulido.ts';
import { recordUsage } from '../../../lib/ai/usage.ts';
import { recordAiTrace } from '../../../lib/ai/trace.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { resolverAccesoIa, mensajeAccesoIa } from '../../../lib/orgs/acceso.ts';
import { fail, ok, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/pulir — T15 (motor-claude, modo "haiku-pulido"): dispara el
 * paso de pulido visual (`pulido.ts#pulirVisualmente`) sobre la generación
 * INICIAL de un recurso, después de que el cliente ya corrió el self-test y
 * el revisor (reusa la MISMA captura que `/api/chat/verificar`, T5).
 *
 * Mismo espíritu que `/api/chat/verificar`: corre SOLO, sin que el docente
 * lo haya pedido — cualquier "no corresponde" (modo distinto, sin motor
 * Sonnet, el modelo no propuso nada, la edición no matcheó) es un `200`
 * discreto con `aplicado:false`, nunca un error. El self-test POSTERIOR a
 * este pulido, y la decisión de "revert" si falla, corren en el cliente
 * (`Workspace.tsx`) — este endpoint nunca toca `Project.currentHtml`: el
 * cliente decide si aplica el HTML que devuelve.
 */

const schema = z.object({
  projectId: z.string().min(1),
  fingerprint: z.string().min(1).max(32),
  captura: z.union([z.string().max(20_000_000), z.array(z.string().max(20_000_000)).max(2)]).nullish(),
});

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const accesoIa = await resolverAccesoIa(user);
  if (!accesoIa.allowed) {
    return fail(mensajeAccesoIa(accesoIa), 403, { reason: accesoIa.reason });
  }

  const settings = await leerAppSettings();
  if (user.isDemo && !settings.demoEnabled) {
    return fail('La demo está cerrada por el momento.', 403);
  }

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const { projectId, fingerprint, captura } = parsed.data;

  const project = await findProjectForActor(projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  // Ver `modos-generacion.ts`: el pulido es parte del modo `haiku-pulido`
  // tal cual lo configuró el admin, sin recorte premium (Sonnet, "medium"
  // de siempre, no un tier premium que `premiumUntilUsd` deba cortar) y sin
  // mirar `engineChosenByTeacher` — un docente que eligió su propio motor a
  // mano no activa un paso que ese modo ni prendió.
  if (settings.generationMode !== 'haiku-pulido' || project.engineChosenByTeacher) {
    return ok({ aplicado: false, motivo: 'modo_no_aplica', html: null });
  }

  if (fingerprintHtml(project.currentHtml) !== fingerprint) {
    return fail('El recurso cambió después del self-test. Volvé a intentarlo.', 409);
  }

  const provider = await motorParaPresetYEsfuerzo({ presetKey: 'claude-sonnet-5-5', effort: 'low' });
  if (!provider) {
    return ok({ aplicado: false, motivo: 'sin_motor_sonnet', html: null });
  }

  const primerMensaje = await prisma.chatMessage.findFirst({
    where: { thread: { projectId: project.id }, role: 'user', undoneAt: null },
    orderBy: { createdAt: 'asc' },
    select: { content: true },
  });

  const arranque = Date.now();
  const resultado = await pulirVisualmente({
    html: project.currentHtml,
    pedidoDocente: primerMensaje?.content ?? '',
    capturaDataUrl: captura ?? null,
    provider,
    signal: request.signal,
  });

  if (resultado.usage) {
    await recordUsage({
      userId: user.id,
      projectId: project.id,
      aiModelId: provider.id,
      model: provider.model,
      promptTokens: resultado.usage.promptTokens,
      cachedInputTokens: resultado.usage.cachedTokens,
      cacheWriteTokens: resultado.usage.cacheWriteTokens,
      completionTokens: resultado.usage.completionTokens,
      precios: provider.precios,
      schedule: provider.schedule,
      purpose: 'POLISH',
    }).catch((error) => {
      console.error('[chat/pulir] no se pudo registrar el consumo del pulido:', error);
      return null;
    });
  }

  await recordAiTrace({
    userId: user.id,
    projectId: project.id,
    turnKind: 'POLISH',
    model: provider.model,
    reasoningEffort: provider.reasoningEffort,
    requestText: primerMensaje?.content ?? '',
    durationMs: Date.now() - arranque,
    editOutcome: resultado.aplicado ? 'fragments' : 'failed',
    htmlCharsBefore: project.currentHtml.length,
    htmlCharsAfter: resultado.aplicado ? resultado.html.length : null,
    generationMode: 'haiku-pulido',
  }).catch((error) => {
    console.error('[chat/pulir] no se pudo registrar la traza del pulido:', error);
  });

  if (!resultado.aplicado) {
    return ok({ aplicado: false, motivo: resultado.motivo, html: null });
  }

  return ok({ aplicado: true, motivo: null, html: resultado.html });
};
