import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findProjectForActor, marcarSiActuaAdmin } from '../../../lib/projects.ts';
import { buildCurrentResourceBlock, buildSystemPrompt, TURNOS_TEMPRANOS } from '../../../lib/ai/prompt.ts';
import { aplicarKitAlTurno } from './stream.ts';
import { temaDe } from '../../../lib/ai/kit.ts';
import {
  razonamientoCorreccion,
  readCompletionStream,
  requestCompletionStream,
  supportsVision,
  type ChatMessage,
  type TokenUsage as MotorTokenUsage,
} from '../../../lib/ai/provider.ts';
import { normalizarMotor } from '../../../lib/ai/catalogo.ts';
import { resolverCapacidades } from '../../../lib/ai/capacidades.ts';
import { fingerprintHtml } from '../../../lib/ai/revision-visual.ts';
import { construirMensajeCorreccion, type InformeAutoprueba } from '../../../lib/ai/autoprueba.ts';
import { checklistActual } from '../../../lib/ai/checklist-db.ts';
import { consumedTokens, recordUsage } from '../../../lib/ai/usage.ts';
import { puedeUsarLaIa } from '../../../lib/auth/domains.ts';
import { consumoDeLaDemo } from '../../../lib/demo.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { UPDATE_RESOURCE_CODE, parseUpdateResourceArgs } from '../../../lib/ai/tools.ts';
import { fail, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/autocorreccion — autocorrección de la autoprueba (round 3,
 * `odd/tasks/arnes-robustez.md`, T12). El cliente la pide DESPUÉS de correr
 * la autoprueba de T11 (`SCRIPT_CENTINELA`, `kit.ts`) en un iframe oculto y
 * encontrar errores reales o un reinicio que no vuelve al estado inicial —
 * ver `ejecutarAutopruebaYCorreccion` en Workspace.tsx.
 *
 * Modelada sobre `visual-review.ts` (mismas puertas: acceso a la IA, apagado
 * de demo, acceso al proyecto, huella contra staleness, tope de tokens —
 * ver los comentarios allá para el detalle de cada una). A propósito NO
 * repite su gate de `puedeElegirVelocidad`/`supportsVision`: la autoprueba
 * no es una feature de prime, corre para cualquier docente — es el harness
 * (T9-T11) arreglando sus propios defectos, no una revisión visual con
 * modelo.
 *
 * Discreto, igual que T8 (T12 hereda la misma decisión de diseño): no crea
 * `ChatMessage`, no crea `ProjectSnapshot` (deshacer sigue revirtiendo el
 * turno COMPLETO que originó este HTML, nunca sólo la corrección — la
 * autoprueba/corrección es parte del mismo turno para el docente). Cada
 * ronda SÍ registra su propio `TokenUsage` (consume el cupo del docente,
 * igual que T7/T8): una fila por ronda, nunca fusionada con la del turno
 * principal.
 *
 * SSE con el mismo vocabulario reducido que T8 (`code`/`done`, sin
 * `error` visible: una corrección que falla nunca puede tapar un turno que
 * ya había terminado bien — se loguea del lado del servidor, una línea por
 * ronda, SIN contenido de HTML: id de proyecto, ronda, cantidad de errores).
 */

const errorSchema = z.object({
  tipo: z.enum(['error', 'promesa', 'consola']),
  mensaje: z.string().max(300),
  linea: z.number().int().nullable(),
  columna: z.number().int().nullable(),
  accion: z.string().max(200),
});

const controlDiffSchema = z.object({
  etiqueta: z.string().max(200),
  antes: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
  despues: z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
});

/** T17 (round 4, "checklist del docente"): un resultado de
 *  `window.__koduPruebas[i]`, tal como lo normaliza el runner de
 *  `SCRIPT_CENTINELA` (T14) — ver `ResultadoPrueba` en `autoprueba.ts`. */
const pruebaSchema = z.object({
  id: z.string().max(40),
  ok: z.boolean(),
  detalle: z.string().max(200),
});

const schema = z.object({
  projectId: z.string().min(1),
  /** `fingerprintHtml` del HTML que la autoprueba probó (T8: mismo criterio,
   *  ver el comentario de `fingerprint` allá). */
  fingerprint: z.string().min(1).max(32),
  /** Como mucho 2 rondas de corrección por autoprueba (T12: "reject ronda >
   *  2"): la unión de literales ya rechaza cualquier otro valor. */
  ronda: z.union([z.literal(1), z.literal(2)]),
  errores: z.array(errorSchema).max(20),
  reinicioOk: z.boolean().nullable(),
  exitoVisibleAlInicio: z.boolean(),
  diferencias: z.object({
    textoQueFalta: z.array(z.string().max(300)).max(5),
    textoQueSobra: z.array(z.string().max(300)).max(5),
    controles: z.array(controlDiffSchema).max(5),
  }),
  /** T17: opcional/nullable a propósito — un cliente viejo (o un recurso sin
   *  checklist) sencillamente no lo manda. */
  pruebas: z.array(pruebaSchema).max(8).optional().nullable(),
});

const encoder = new TextEncoder();

function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Mismo intervalo que /api/chat/stream y visual-review.ts. */
const HEARTBEAT_MS = 10_000;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  // Mismas puertas que /api/chat/stream y visual-review.ts, en el mismo
  // orden (ver los comentarios allá).
  if (!(await puedeUsarLaIa(user))) {
    return fail('Tu cuenta todavía no tiene habilitado el uso de la IA. Escribinos y lo vemos.', 403);
  }

  const settings = await leerAppSettings();
  if (user.isDemo && !settings.demoEnabled) {
    return fail('La demo está cerrada por el momento.', 403);
  }

  const capacidades = resolverCapacidades(user, settings);

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }
  const { projectId, fingerprint, ronda, errores, reinicioOk, exitoVisibleAlInicio, diferencias, pruebas } =
    parsed.data;

  const project = await findProjectForActor(projectId, user);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  // El docente pudo haber editado el código (u otra pestaña terminó un
  // turno) entre que se corrió la autoprueba y que este pedido llegó: si
  // `currentHtml` ya no es el HTML probado, ni las líneas de origen citadas
  // ni el diagnóstico siguen siendo válidos.
  if (fingerprintHtml(project.currentHtml) !== fingerprint) {
    return fail('El recurso cambió después de la autoprueba. Volvé a intentarlo.', 409);
  }

  const provider = await normalizarMotor(project.aiModelId, capacidades.prime);
  if (!provider) return fail('No hay ningún motor de IA habilitado.', 503);

  if (user.isDemo) {
    const consumidos = await consumoDeLaDemo();
    if (consumidos >= settings.demoTokenLimit) {
      return fail('La demo ya usó todo el crédito de esta ronda.', 429);
    }
  }

  if (provider.userTokenLimit > 0) {
    const usados = await consumedTokens(user.id, provider.id, provider.userTokenWindowHours);
    if (usados >= provider.userTokenLimit) {
      return fail(
        `Alcanzaste tu tope de ${provider.userTokenLimit.toLocaleString('es-AR')} tokens en ${provider.label}.`,
        429,
      );
    }
  }

  // M8 (design.md §7): mismo criterio que stream.ts/visual-review.ts.
  await marcarSiActuaAdmin(project, user);

  const temaProyecto = temaDe(project.currentHtml);
  const htmlPreCorreccion = project.currentHtml;

  const [globalRules, userRules, assets] = await Promise.all([
    prisma.customRule.findMany({
      where: { isGlobal: true, isActive: true },
      select: { title: true, content: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.customRule.findMany({
      where: { userId: user.id, isActive: true },
      select: { title: true, content: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.projectAsset.findMany({ where: { projectId: project.id }, orderBy: { createdAt: 'asc' } }),
  ]);

  const assetContexts = assets.map((asset) => ({
    filename: asset.filename,
    url: asset.url,
    fileType: asset.fileType,
    extractedText: asset.extractedText,
  }));

  // El prompt de sistema "de siempre", igual que visual-review.ts: pedido
  // mecánico de una sola llamada, sin hilo al que volver.
  const systemPrompt = buildSystemPrompt({
    globalRules,
    userRules,
    assets: assetContexts,
    canSeeImages: supportsVision(provider),
    turnosPrevios: TURNOS_TEMPRANOS + 1,
    herramientaForzada: false,
  });

  const informe: InformeAutoprueba = { errores, reinicioOk, exitoVisibleAlInicio, diferencias, pruebas };
  // T17: el checklist VIGENTE lo carga el SERVIDOR (nunca lo que mande el
  // cliente): es lo mismo que ya hace este endpoint con `htmlPreCorreccion`
  // — el texto de cada ítem citado en la corrección tiene que ser el real.
  const checklist = await checklistActual(project.id);
  const mensajeCorreccion = construirMensajeCorreccion({ html: htmlPreCorreccion, informe, ronda, checklist });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `${buildCurrentResourceBlock(htmlPreCorreccion, project.title, false)}\n\n${mensajeCorreccion}`,
    },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(payload));
        } catch {
          closed = true;
        }
      };

      try {
        controller.enqueue(encoder.encode(': abierto\n\n'));
      } catch {
        closed = true;
      }

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          closed = true;
        }
      }, HEARTBEAT_MS);

      let codeUpdated = false;

      try {
        // Una sola llamada al MISMO motor, forzada (a diferencia de la
        // revisión visual: acá no hay "el modelo puede decidir que no hace
        // falta nada", ya se sabe que hay algo roto que corregir).
        // Razonamiento "low" (T12: `razonamientoCorreccion`, no `Speed` —
        // ver el comentario grande de arriba de este archivo).
        const respuesta = await requestCompletionStream({
          messages,
          provider,
          signal: request.signal,
          forzarHerramienta: true,
          razonamientoOverride: razonamientoCorreccion(provider),
        });

        let htmlFinal: string | null = null;
        const totales: { usage: MotorTokenUsage | null } = { usage: null };

        for await (const event of readCompletionStream(respuesta)) {
          if (event.type === 'usage') {
            totales.usage = event.usage;
            continue;
          }
          if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
            const resultado = parseUpdateResourceArgs(event.arguments, event.truncated);
            if (resultado.ok) htmlFinal = aplicarKitAlTurno(resultado.html, temaProyecto);
          }
        }

        if (totales.usage) {
          // Fila PROPIA por ronda (nunca fusionada con la del turno
          // principal): consume el cupo del docente igual que T7/T8.
          await recordUsage({
            userId: user.id,
            projectId: project.id,
            aiModelId: provider.id,
            model: provider.model,
            promptTokens: totales.usage.promptTokens,
            cachedInputTokens: totales.usage.cachedTokens,
            completionTokens: totales.usage.completionTokens,
            precios: provider.precios,
          }).catch((error) =>
            console.error(`[chat/autocorreccion] ronda ${ronda}: no se pudo registrar el consumo:`, error),
          );
        }

        if (htmlFinal) {
          await prisma.project.update({ where: { id: project.id }, data: { currentHtml: htmlFinal } });
          codeUpdated = true;
          send({ type: 'code', html: htmlFinal });
        }

        // Una línea por ronda, sin contenido de HTML (proyecto, ronda,
        // cantidad de errores, si terminó aplicando algo).
        console.log(
          `[chat/autocorreccion] proyecto=${project.id} ronda=${ronda} errores=${errores.length} ` +
            `reinicioOk=${reinicioOk} corrigioCodigo=${codeUpdated}`,
        );
      } catch (error) {
        // Nunca se surface un error visible: el turno que trajo esta
        // corrección ya había terminado bien (mismo criterio que T8). Un
        // abort ("Detener") pasa por acá igual y es exactamente lo que
        // tiene que pasar.
        console.error(`[chat/autocorreccion] ronda ${ronda}: no se pudo completar la corrección:`, error);
      } finally {
        send({ type: 'done', codeUpdated });
        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* el navegador ya se había ido */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
};
