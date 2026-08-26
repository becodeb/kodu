import type { APIRoute } from 'astro';
import { z } from 'zod';
import { prisma } from '../../../lib/db.ts';
import { findOwnedProject } from '../../../lib/projects.ts';
import { buildSystemPrompt } from '../../../lib/ai/prompt.ts';
import {
  ProviderError,
  alternateChoice,
  isChoiceConfigured,
  normalizarEleccion,
  readCompletionStream,
  requestCompletionStream,
  resolveProvider,
  supportsVision,
  type ChatMessage,
  type ContentPart,
  type ModelChoice,
} from '../../../lib/ai/provider.ts';
import { consumedTokens, recordUsage } from '../../../lib/ai/usage.ts';
import { UPDATE_RESOURCE_CODE, parseUpdateResourceArgs } from '../../../lib/ai/tools.ts';
import { readImageAsDataUrl } from '../../../lib/uploads.ts';
import { fail, readBody } from '../../../lib/http.ts';

/**
 * POST /api/chat/stream — proxy de streaming contra DeepSeek (SPEC §2 y §4).
 *
 * Devuelve SSE con eventos ya digeridos para el navegador:
 *   {type:"text",  delta}   fragmento de la explicación (va al chat)
 *   {type:"code",  html}    resultado del tool call (va al iframe, NO al chat)
 *   {type:"done",  ...}     fin del turno
 *   {type:"error", message} algo falló
 *
 * El HTML nunca aparece en el flujo de texto: viaja por `update_resource_code`.
 */

/**
 * Techo absoluto del mensaje, sólo para que un body descomunal no tumbe al
 * servidor. El límite que le importa al docente es el del proveedor.
 */
const MAX_MESSAGE_CHARS = 500_000;

const schema = z.object({
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  // El tope real depende del proveedor y se chequea abajo, cuando ya se sabe
  // cuál eligió el docente. Este es sólo el techo que protege al servidor de un
  // body absurdo, no una decisión de producto.
  message: z
    .string()
    .trim()
    .min(1, 'Escribí un mensaje')
    .max(MAX_MESSAGE_CHARS, 'El mensaje es demasiado largo para procesarlo.'),
  attachmentUrls: z.array(z.string().max(500)).max(10).optional(),
  model: z.enum(['ALPHA', 'DEEPSEEK', 'MINIMAX']).optional(),
  /** El docente tocó el código a mano desde la última respuesta de la IA. */
  codeEditedByTeacher: z.boolean().optional(),
});

/** Cuántos mensajes del hilo se reenvían como historial. */
const HISTORY_LIMIT = 40;

/**
 * Qué se le dice al docente cuando el tool call no se pudo aplicar. Reemplazan
 * al viejo "No pude generar una respuesta.", que no explicaba nada y dejaba la
 * sensación de que la plataforma estaba rota.
 */
const CODE_PROBLEMS: Record<'truncated' | 'invalid' | 'empty', string> = {
  truncated:
    'El recurso quedó a medio escribir porque superó el largo máximo que el modelo puede devolver de una vez, así que no lo apliqué (tu versión anterior sigue intacta). Pedime el cambio por partes: primero una sección, después la otra.',
  invalid:
    'El modelo devolvió el código con un formato que no pude leer, así que no toqué tu recurso. Volvé a mandarme el pedido.',
  empty: 'El modelo devolvió un recurso vacío, así que no apliqué el cambio. Probá de nuevo.',
};

const SILENT_TURN =
  'El motor de IA cortó el turno sin devolver nada. Tu recurso quedó como estaba. Probá de nuevo y, si vuelve a pasar, mandá el pedido en partes más chicas.';

/**
 * Cuántas imágenes del proyecto se reenvían cuando el mensaje no trae adjuntos.
 *
 * Es 1 y no más: medido, cada imagen cuesta ~850 tokens de prompt aun pesando
 * 15 KB, y el modelo gratuito estrangula los pedidos con imagen mucho antes que
 * los de texto. Reenviar cuatro en cada turno convertía una conversación normal
 * en una fila de 429.
 */
const MAX_CONTEXT_IMAGES = 1;

/**
 * Cada cuánto se manda una señal de vida por el SSE.
 *
 * Mientras la IA escribe el recurso, el servidor recibe datos del proveedor pero
 * no le manda NADA al navegador: el HTML recién sale cuando el tool call está
 * completo, y eso puede tardar minutos. Para el proxy que hay en el medio esa
 * conexión parece muerta y la corta, y se pierde el turno entero (AbortError
 * del lado del servidor, "El servidor rechazó el pedido" del lado del docente).
 * El comentario SSE `:` la mantiene viva sin ensuciar el flujo: el cliente lo
 * ignora solo.
 */
const HEARTBEAT_MS = 10_000;

/** Cuántos intentos se le anuncian al docente (primer intento + reintentos). */
const REINTENTOS_VISIBLES = 10;

const encoder = new TextEncoder();

function sseFrame(payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Arma el contenido del mensaje del docente.
 *
 * Con `AI_VISION` prendido las imágenes viajan como partes `image_url` en
 * base64. Detalle que importa: si este mensaje no trae adjuntos, igual se le
 * mandan las imágenes del proyecto. Sin eso, la imagen sólo existía para el
 * modelo en el turno exacto en que se subía, y al pedirle "leé la imagen" en el
 * mensaje siguiente contestaba, con razón, que no la veía.
 *
 * Apagado (default), sólo se nombran: el system prompt ya le aclara que no las
 * ve y que tiene que preguntar.
 */
async function buildUserContent(
  message: string,
  attachmentUrls: string[],
  projectImageUrls: string[],
  choice: ModelChoice,
): Promise<string | ContentPart[]> {
  const own = attachmentUrls.length > 0;
  // Las del mensaje mandan; si no hay, las del proyecto (las últimas, acotadas
  // para no inflar el pedido sin necesidad).
  const candidates = own ? attachmentUrls : projectImageUrls.slice(-MAX_CONTEXT_IMAGES);

  if (candidates.length === 0) return message;

  const names = candidates.map((url) => url.split('/').pop() ?? url).join(', ');

  if (!supportsVision(choice)) {
    return own
      ? `${message}

[El docente adjuntó a este mensaje: ${names}. No podés ver su contenido.]`
      : message;
  }

  const images = (
    await Promise.all(candidates.map((url) => readImageAsDataUrl(url)))
  ).filter((dataUrl): dataUrl is string => dataUrl !== null);

  if (images.length === 0) {
    return own ? `${message}

[El docente adjuntó: ${names}, pero no se pudieron leer.]` : message;
  }

  const preface = own
    ? message
    : `${message}

[Adjunto de nuevo las imágenes que el docente ya había subido a este recurso: ${names}.]`;

  return [
    { type: 'text', text: preface },
    ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
  ];
}

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user!;

  const parsed = schema.safeParse(await readBody(request));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? 'Datos inválidos', 422);
  }

  const { projectId, threadId, message, attachmentUrls, model, codeEditedByTeacher } = parsed.data;

  const project = await findOwnedProject(projectId, user.id);
  if (!project) return fail('El recurso no existe o no es tuyo.', 404);

  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, projectId: project.id },
    select: { id: true },
  });
  if (!thread) return fail('El hilo de conversación no existe.', 404);

  /**
   * El motor lo decide la plataforma, no el pedido.
   *
   * DeepSeek está bajo llave: se paga por token y sólo entra como respaldo
   * automático cuando MiniMax agota sus reintentos. Por eso lo que llega en el
   * body —o lo que quedó guardado en un proyecto viejo— se normaliza contra la
   * lista de elegibles en vez de usarse tal cual.
   */
  const chosenModel = normalizarEleccion(model ?? project.selectedModel);

  if (chosenModel !== project.selectedModel) {
    await prisma.project.update({
      where: { id: project.id },
      data: { selectedModel: chosenModel },
    });
  }

  const [globalRules, userRules, assets, history] = await Promise.all([
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
    prisma.projectAsset.findMany({
      where: { projectId: project.id },
      orderBy: { createdAt: 'asc' },
    }),
    // Los ÚLTIMOS N mensajes: se piden en orden descendente y se dan vuelta.
    // Con `asc` + `take` se mandarían los primeros, que es justo lo contrario de
    // lo que necesita el contexto en una conversación larga.
    prisma.chatMessage.findMany({
      where: { threadId: thread.id },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { role: true, content: true },
    }),
  ]);

  const assetContexts = assets.map((asset) => ({
    filename: asset.filename,
    url: asset.url,
    fileType: asset.fileType,
    extractedText: asset.extractedText,
  }));

  const provider = resolveProvider(chosenModel);

  // Un pedido larguísimo no entra en la ventana de contexto del modelo junto con
  // el HTML del recurso y el historial. Se avisa acá, con el número y con la
  // salida concreta, en vez de dejar que la API lo rechace con su propio error.
  if (message.length > provider.maxInputChars) {
    const otro = alternateChoice(chosenModel);
    const otroProveedor = resolveProvider(otro);
    const sirveElOtro =
      isChoiceConfigured(otro) && otroProveedor.maxInputChars >= message.length;

    return fail(
      `Tu mensaje tiene ${message.length.toLocaleString('es-AR')} caracteres y ${provider.label} ` +
        `admite hasta ${provider.maxInputChars.toLocaleString('es-AR')}. ` +
        (sirveElOtro
          ? `Con ${otroProveedor.label} entra: cambiá el modelo y volvé a mandarlo.`
          : 'Mandalo en dos partes: primero el contexto, después el pedido.'),
      413,
      sirveElOtro ? { fallbackModel: otro, fallbackLabel: otroProveedor.label } : {},
    );
  }

  // El tope por usuario se chequea ANTES de gastar: avisar después de consumir
  // no sirve de nada. Se ofrece el otro proveedor, que es la salida real.
  if (provider.userTokenLimit > 0) {
    const usados = await consumedTokens(user.id, chosenModel);
    if (usados >= provider.userTokenLimit) {
      const otro = alternateChoice(chosenModel);
      return fail(
        `Alcanzaste tu tope de ${provider.userTokenLimit.toLocaleString('es-AR')} tokens en ${provider.label}. ` +
          `Cambiá el modelo a ${resolveProvider(otro).label}, que no tiene tope, o pedile más cupo a la administración.`,
        429,
      );
    }
  }

  const systemPrompt = buildSystemPrompt({
    globalRules,
    userRules,
    assets: assetContexts,
    currentHtml: project.currentHtml,
    projectTitle: project.title,
    canSeeImages: supportsVision(chosenModel),
    htmlEditedByTeacher: codeEditedByTeacher ?? false,
  });

  const userContent = await buildUserContent(
    message,
    attachmentUrls ?? [],
    assets.filter((asset) => asset.fileType === 'image').map((asset) => asset.url),
    chosenModel,
  );

  // Se persiste ANTES de llamar a la IA: si el turno se corta, el docente no
  // pierde lo que escribió.
  await prisma.chatMessage.create({
    data: {
      threadId: thread.id,
      role: 'user',
      content: message,
      attachments: attachmentUrls?.length ? JSON.stringify(attachmentUrls) : null,
    },
  });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...[...history].reverse().map((entry) => ({
      role: entry.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: entry.content,
    })),
    { role: 'user', content: userContent },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Una vez que el navegador se va, el controller queda cerrado y cualquier
      // enqueue tira ERR_INVALID_STATE. Envolverlo evita que un cliente que se
      // desconecta rompa el guardado del turno.
      let closed = false;
      const send = (payload: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(payload));
        } catch {
          closed = true;
        }
      };

      // Un byte apenas arranca: a partir de acá la conexión ya tiene tráfico y
      // ningún intermediario la puede dar por muerta.
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

      /**
       * El pedido al proveedor va ACÁ ADENTRO, no antes de devolver la Response.
       *
       * Hecho afuera, el servidor se quedaba sin mandar un solo byte durante
       * todo el tiempo que el proveedor tardaba en contestar las cabeceras —y
       * con una imagen en base64 encima, ese rato es largo—. Para el proxy del
       * medio esa conexión nunca arrancó, la corta con un 502, y como el corte
       * no pasa por nuestro código no queda ni una línea en los logs: justo el
       * 502 sin rastro que veíamos. Adentro del stream, el keepalive ya está
       * corriendo mientras se espera.
       */
      // Trazas con tiempos: cuando un turno se cae, lo primero que hace falta
      // saber es si tardó el proveedor en contestar o si se cortó a mitad del
      // stream. Sin esto, un 502 no dejaba ni una línea.
      const arranque = Date.now();
      const transcurrido = () => `${((Date.now() - arranque) / 1000).toFixed(1)}s`;
      console.log(
        `[chat/stream] inicio proyecto=${project.id} modelo=${chosenModel} mensaje=${message.length}c imagenes=${Array.isArray(userContent) ? userContent.length - 1 : 0}`,
      );

      /**
       * Pide el turno, y si el principal no da más cae solo al respaldo.
       *
       * El docente no tiene por qué enterarse de que un proveedor está caído ni
       * tener que elegir otro a mano: se avisa qué pasó y se sigue trabajando.
       */
      const pedirA = (usado: typeof provider, intentos: number) =>
        requestCompletionStream({
          messages,
          provider: usado,
          signal: request.signal,
          onReintento: (intento, esperaMs) => {
            console.warn(`[chat/stream] ${usado.label} saturado, reintento ${intento} en ${esperaMs}ms`);
            send({
              type: 'notice',
              message: `${usado.label} está saturado. Reintentando (${intento} de ${intentos})…`,
            });
          },
        });

      let upstream: Response;
      let proveedorUsado = provider;

      try {
        try {
          upstream = await pedirA(provider, REINTENTOS_VISIBLES);
        } catch (fallaPrincipal) {
          const respaldo = resolveProvider(alternateChoice(chosenModel));
          const abortado =
            fallaPrincipal instanceof ProviderError && fallaPrincipal.status === 499;

          if (abortado || !isChoiceConfigured(respaldo.choice)) throw fallaPrincipal;

          console.warn(
            `[chat/stream] ${provider.label} agotó los reintentos a los ${transcurrido()}; se pasa a ${respaldo.label}`,
          );
          send({
            type: 'notice',
            message: `${provider.label} no respondió después de varios intentos. Sigo con ${respaldo.label}.`,
          });

          proveedorUsado = respaldo;
          upstream = await pedirA(respaldo, REINTENTOS_VISIBLES);
        }
        console.log(
          `[chat/stream] ${proveedorUsado.label} respondió cabeceras en ${transcurrido()}`,
        );
      } catch (error) {
        console.error(`[chat/stream] el proveedor falló a los ${transcurrido()}:`, (error as Error).message);
        const otro = alternateChoice(chosenModel);
        const puedeCambiar =
          (!(error instanceof ProviderError) || error.canFallback) && isChoiceConfigured(otro);
        const detalle = (error as Error).message;

        send({
          type: 'error',
          message: detalle,
          fallbackModel: puedeCambiar ? otro : undefined,
          fallbackLabel: puedeCambiar ? resolveProvider(otro).label : undefined,
        });

        // Se deja constancia en el hilo: si no, el último mensaje sigue siendo
        // el del docente y al recargar la página el editor se queda esperando
        // una respuesta que nunca va a llegar.
        try {
          const saved = await prisma.chatMessage.create({
            data: { threadId: thread.id, role: 'assistant', content: `No pude completar el pedido. ${detalle}` },
            select: { id: true },
          });
          send({ type: 'done', messageId: saved.id, codeUpdated: false, content: `No pude completar el pedido. ${detalle}` });
        } catch (dbError) {
          console.error('[chat/stream] no se pudo registrar el fallo del proveedor:', dbError);
        }

        clearInterval(heartbeat);
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* el navegador ya se había ido */
          }
        }
        return;
      }

      let assistantText = '';
      let generatedHtml: string | null = null;
      // Diagnóstico legible cuando el código no se pudo aplicar. Se guarda en el
      // hilo junto con la explicación de la IA: si no, el modelo dice "listo,
      // cambié el fondo", el recurso no cambia y el docente no entiende por qué.
      let codeProblem: string | null = null;
      let finishReason = '';
      let usage: { promptTokens: number; completionTokens: number } | null = null;

      try {
        for await (const event of readCompletionStream(upstream)) {
          if (event.type === 'text') {
            assistantText += event.delta;
            send({ type: 'text', delta: event.delta });
            continue;
          }

          if (event.type === 'tool_start') {
            // El tool call puede tardar un rato largo en completarse; avisamos
            // apenas arranca para que el chat deje de decir que está escribiendo.
            send({ type: 'code_start' });
            continue;
          }

          if (event.type === 'usage') {
            usage = event.usage;
            continue;
          }

          if (event.type === 'finish') {
            finishReason = event.reason;
            continue;
          }

          if (event.type === 'tool' && event.name === UPDATE_RESOURCE_CODE) {
            const result = parseUpdateResourceArgs(event.arguments, event.truncated);

            if (result.ok) {
              generatedHtml = result.html;
              codeProblem = null;
              send({ type: 'code', html: result.html });
            } else {
              codeProblem = CODE_PROBLEMS[result.reason];
              send({ type: 'error', message: codeProblem });
            }
          }
        }
      } catch (error) {
        console.error('[chat/stream]', error);
        send({ type: 'error', message: 'Se cortó la conexión con el motor de IA.' });
      } finally {
        // El consumo se registra aunque el turno se haya cortado: los tokens ya
        // se gastaron igual.
        if (usage) {
          await recordUsage({
            userId: user.id,
            provider: proveedorUsado.choice,
            model: proveedorUsado.model,
            ...usage,
          }).catch((error) => console.error('[chat/stream] no se pudo registrar el consumo:', error));
        }

        // Persistir pase lo que pase: si el docente cierra la pestaña a mitad de
        // camino, lo generado hasta ahí queda guardado.
        try {
          if (generatedHtml) {
            await prisma.project.update({
              where: { id: project.id },
              data: { currentHtml: generatedHtml },
            });
          }

          // Un turno que se corta por tope de tokens con texto a medias también
          // merece explicación, aunque el código haya entrado bien.
          const cutNote =
            finishReason === 'length' && !codeProblem
              ? 'La respuesta quedó cortada porque llegué al límite de largo. Pedime lo que falte y sigo.'
              : null;

          const notes = [assistantText.trim(), codeProblem, cutNote].filter(
            (part): part is string => Boolean(part),
          );

          const finalText =
            notes.length > 0
              ? notes.join('\n\n')
              : generatedHtml
                ? 'Actualicé el recurso.'
                : SILENT_TURN;

          const saved = await prisma.chatMessage.create({
            data: { threadId: thread.id, role: 'assistant', content: finalText },
            select: { id: true },
          });

          send({
            type: 'done',
            messageId: saved.id,
            codeUpdated: Boolean(generatedHtml),
            content: finalText,
          });
        } catch (error) {
          console.error('[chat/stream] no se pudo persistir el turno:', error);
        }

        clearInterval(heartbeat);
        console.log(
          `[chat/stream] fin en ${transcurrido()} texto=${assistantText.length}c codigo=${Boolean(generatedHtml)} corte=${finishReason || 'ninguno'}`,
        );
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
      // Evita que Nginx bufferee el stream en producción.
      'X-Accel-Buffering': 'no',
    },
  });
};
