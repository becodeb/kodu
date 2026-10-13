import { prisma } from '../db.ts';
import type { UsagePurpose, TraceEditOutcome } from '../../generated/prisma/client.ts';
import { suscripcionIndividualVigente } from '../billing/creditos-servicio.ts';
import { decidirPreguntaFeedback, type TipoPreguntaFeedback } from '../feedback/frecuencia.ts';

/**
 * odd/tasks/ahorro-tokens.md (T4): la traza por turno. A propósito un
 * módulo APARTE de `recordUsage` (`src/lib/ai/usage.ts`) y no una extensión
 * de su `UsageRecord`: cada sitio que llama a `recordUsage` tiene datos muy
 * distintos disponibles en momentos distintos del turno (reintentos,
 * truncado, autoprueba, hallazgos del verificador) — forzarlos todos en una
 * sola interfaz usada por 6 llamadores infla la mitad de ellos con campos
 * que nunca completan. Acá cada llamador pasa sólo lo que de verdad tiene.
 *
 * La escritura es SIEMPRE best-effort: ninguna función de este archivo tira
 * — una falla se loguea y se devuelve `null`, nunca rompe el turno que ya
 * terminó bien para el docente (mismo criterio que `recordUsage` ya aplica
 * al débito de créditos).
 */

export type EditOutcomeLlamador = 'full' | 'fragments' | 'fragments_fallback' | 'failed' | null;

function editOutcomeAEnum(valor: EditOutcomeLlamador): TraceEditOutcome | null {
  switch (valor) {
    case 'full':
      return 'FULL';
    case 'fragments':
      return 'FRAGMENTS';
    case 'fragments_fallback':
      return 'FRAGMENTS_FALLBACK';
    case 'failed':
      return 'FAILED';
    default:
      return null;
  }
}

export type PlanDeCuenta = 'FREE' | 'INDIVIDUAL' | 'ORG';

/**
 * 'ORG' si la cuenta pertenece a una organización (las organizaciones no
 * tienen plan Individual, decisión del dueño — odd/tasks/planes-y-cobros.md).
 * Si no, 'INDIVIDUAL' con una suscripción Individual vigente hoy, o 'FREE'
 * sin fila (mismo criterio que `esTallerSinRazonamiento`, T2 de esta misma
 * tarea de ahorro de tokens — "sin fila = FREE").
 */
export async function resolverPlanDeCuenta(userId: string, organizationId: string | null): Promise<PlanDeCuenta> {
  if (organizationId !== null) return 'ORG';
  const vigente = await suscripcionIndividualVigente(userId, new Date());
  return vigente !== null ? 'INDIVIDUAL' : 'FREE';
}

export interface AiTraceInput {
  userId: string;
  /** `null` sólo en el Taller de ideas (todavía no hay recurso). */
  projectId: string | null;
  tokenUsageId?: string | null;
  turnKind: UsagePurpose;
  model: string;
  reasoningEffort?: string | null;
  requestText: string;
  editOutcome?: EditOutcomeLlamador;
  retries?: number;
  truncated?: boolean;
  htmlCharsBefore?: number | null;
  htmlCharsAfter?: number | null;
  durationMs?: number | null;
  selfTestPassed?: number | null;
  selfTestFailed?: number | null;
  correctionRounds?: number | null;
  verifierFindings?: number | null;
  /** T4 (round 1, motor-claude): qué disparó esta ronda de corrección
   *  (`necesitaCorreccion`, autoprueba.ts) — un subconjunto no vacío de
   *  `'errors' | 'reset' | 'tests'`, o `null` fuera de CORRECTION. */
  correctionTriggers?: readonly ('errors' | 'reset' | 'tests')[] | null;
  /** T11 (motor-claude): el modo de generación EFECTIVO activo cuando corrió
   *  este turno (`modoEfectivo`, modos-generacion.ts) — snapshot de lectura,
   *  `null` cuando el llamador no lo tiene a mano. */
  generationMode?: string | null;
  /** T11: 'creation' | 'adjustment', el rol que jugó este turno — ver el
   *  comentario de `AiTrace.turnRole` en el schema. */
  turnRole?: 'creation' | 'adjustment' | null;
  /** T11: el `chatMessageId` del turno de creación/ajuste que disparó esta
   *  ronda (CORRECTION/VERIFICATION) — ver `ultimoChatMessageIdDelProyecto`
   *  más abajo, el helper que lo resuelve. */
  parentChatMessageId?: string | null;
  /** T11: cuánto tardó la autoprueba del navegador, medida del lado del
   *  cliente — ver el comentario de la columna en el schema. */
  selfTestDurationMs?: number | null;
  /** T11: las banderas rojas determinísticas que dispararon en este pasaje
   *  del verificador (`detectarBanderasRojas`, turno-diff.ts). */
  redFlags?: readonly string[] | null;
  /** T11: si la corrección disparada por una bandera roja terminó aplicando
   *  la edición (no mide si el contenido es el pedido, sólo si se aplicó). */
  redFlagsFixed?: boolean | null;
  /**
   * Sólo GENERATION/ADJUSTMENT (los únicos turnos con una respuesta visible
   * en el chat que vale la pena preguntarle al docente) activan la decisión
   * de T5 ("¿Funciona bien?"/"¿Te gusta cómo se ve?"). El resto de los
   * sitios (corrección, verificación, extra versión, Taller) simplemente no
   * la pide — `false` por defecto.
   */
  considerarPreguntaFeedback?: boolean;
  /** Sólo relevante junto con `considerarPreguntaFeedback`: si este turno
   *  era la primera generación del recurso (proyecto recién creado). */
  esPrimeraGeneracion?: boolean;
}

export interface AiTraceResultado {
  id: string;
  /** La pregunta inline que se decidió mostrar junto a este turno, si
   *  `considerarPreguntaFeedback` estaba en `true` y correspondía una. */
  preguntaFeedback: TipoPreguntaFeedback | null;
}

/**
 * Registra una fila de `AiTrace`. Devuelve `null` si algo falló — el
 * llamador NUNCA debe tratar eso como un error del turno, sólo loguearlo
 * (ya lo logueamos acá) y seguir.
 */
export async function recordAiTrace(input: AiTraceInput): Promise<AiTraceResultado | null> {
  try {
    const actor = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { organizationId: true, feedbackPromptsDisabled: true },
    });
    const organizationId = actor?.organizationId ?? null;
    const planAtCall = await resolverPlanDeCuenta(input.userId, organizationId);

    let preguntaFeedback: TipoPreguntaFeedback | null = null;

    if (input.considerarPreguntaFeedback && input.projectId) {
      const proyecto = await prisma.project.findUnique({
        where: { id: input.projectId },
        select: { feedbackTurnsSinceAsk: true, lastFeedbackPromptKind: true },
      });

      const haySinResponder = await prisma.aiTrace.findFirst({
        where: {
          projectId: input.projectId,
          inlineQuestionKind: { not: null },
          inlineQuestionAnswer: null,
        },
        select: { id: true },
      });

      const decision = decidirPreguntaFeedback({
        promptsDeshabilitados: actor?.feedbackPromptsDisabled ?? false,
        esPrimeraGeneracion: Boolean(input.esPrimeraGeneracion),
        turnosDesdeUltimaPregunta: proyecto?.feedbackTurnsSinceAsk ?? 0,
        ultimoTipoPreguntado: (proyecto?.lastFeedbackPromptKind as TipoPreguntaFeedback | null) ?? null,
        hayPreguntaSinResponder: haySinResponder !== null,
      });

      if (decision.mostrar && decision.tipo) {
        preguntaFeedback = decision.tipo;
        await prisma.project.update({
          where: { id: input.projectId },
          data: { feedbackTurnsSinceAsk: 0, lastFeedbackPromptKind: decision.tipo },
        });
      } else {
        await prisma.project.update({
          where: { id: input.projectId },
          data: { feedbackTurnsSinceAsk: { increment: 1 } },
        });
      }
    }

    const fila = await prisma.aiTrace.create({
      data: {
        userId: input.userId,
        projectId: input.projectId,
        tokenUsageId: input.tokenUsageId ?? null,
        organizationId,
        planAtCall,
        turnKind: input.turnKind,
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? null,
        requestText: input.requestText,
        editOutcome: editOutcomeAEnum(input.editOutcome ?? null),
        retries: input.retries ?? 0,
        truncated: input.truncated ?? false,
        htmlCharsBefore: input.htmlCharsBefore ?? null,
        htmlCharsAfter: input.htmlCharsAfter ?? null,
        durationMs: input.durationMs ?? null,
        selfTestPassed: input.selfTestPassed ?? null,
        selfTestFailed: input.selfTestFailed ?? null,
        correctionRounds: input.correctionRounds ?? null,
        verifierFindings: input.verifierFindings ?? null,
        correctionTriggers: input.correctionTriggers && input.correctionTriggers.length > 0 ? input.correctionTriggers.join(',') : null,
        generationMode: input.generationMode ?? null,
        turnRole: input.turnRole ?? null,
        parentChatMessageId: input.parentChatMessageId ?? null,
        selfTestDurationMs: input.selfTestDurationMs ?? null,
        redFlags: input.redFlags && input.redFlags.length > 0 ? input.redFlags.join(',') : null,
        redFlagsFixed: input.redFlagsFixed ?? null,
        inlineQuestionKind: preguntaFeedback,
      },
      select: { id: true },
    });

    return { id: fila.id, preguntaFeedback };
  } catch (error) {
    console.error('[ai/trace] no se pudo registrar la traza (no bloqueante):', error);
    return null;
  }
}

/** Ata la traza recién creada al mensaje "assistant" que cerró el turno —
 *  se llama DESPUÉS de `prisma.chatMessage.create`, porque la traza nace
 *  antes de que ese mensaje exista (mismo orden que ya tenía `recordUsage`). */
export async function vincularTrazaAMensaje(aiTraceId: string, chatMessageId: string): Promise<void> {
  try {
    await prisma.aiTrace.update({ where: { id: aiTraceId }, data: { chatMessageId } });
  } catch (error) {
    console.error('[ai/trace] no se pudo vincular la traza al mensaje (no bloqueante):', error);
  }
}

/**
 * odd/tasks/ahorro-tokens.md (T5): señales implícitas (a) y (c). Se llama
 * UNA vez por turno nuevo, antes de procesarlo, sobre la traza más reciente
 * del proyecto que ya tiene un mensaje asociado (el turno anterior que de
 * verdad cerró). Nunca bloquea el turno nuevo.
 */
export async function aplicarSenalesImplicitas(params: {
  projectId: string;
  fraseDefecto: string | null;
  codeEditedByTeacher: boolean;
}): Promise<void> {
  if (!params.fraseDefecto && !params.codeEditedByTeacher) return;

  try {
    const anterior = await prisma.aiTrace.findFirst({
      where: { projectId: params.projectId, chatMessageId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!anterior) return;

    await prisma.aiTrace.update({
      where: { id: anterior.id },
      data: {
        ...(params.fraseDefecto ? { suspectedDefect: true, suspectedDefectPhrase: params.fraseDefecto } : {}),
        ...(params.codeEditedByTeacher ? { codeEditedByTeacherSignal: true } : {}),
      },
    });
  } catch (error) {
    console.error('[ai/trace] no se pudieron aplicar las señales implícitas (no bloqueante):', error);
  }
}

/** odd/tasks/ahorro-tokens.md (T5): señal implícita (b), llamada desde
 *  `POST /api/projects/[id]/undo` sobre la traza del mensaje deshecho. */
export async function marcarTrazaDeshecha(chatMessageId: string): Promise<void> {
  try {
    await prisma.aiTrace.updateMany({ where: { chatMessageId }, data: { undoneSignal: true } });
  } catch (error) {
    console.error('[ai/trace] no se pudo marcar la traza como deshecha (no bloqueante):', error);
  }
}

/**
 * odd/tasks/motor-claude.md (T11): el `chatMessageId` del turno de
 * creación/ajuste más reciente de este proyecto — MISMA consulta que
 * `aplicarSenalesImplicitas` ya usa para encontrar "el turno anterior que de
 * verdad cerró". `autocorreccion.ts`/`verificar.ts` (que nunca crean su
 * propio `ChatMessage`) la usan para completar `parentChatMessageId` y así
 * poder sumar el costo COMPLETO de un turno. Best-effort: `null` si no hay
 * ninguno o si la consulta falla (nunca bloquea la ronda que lo pide).
 */
export async function ultimoChatMessageIdDelProyecto(projectId: string): Promise<string | null> {
  try {
    const fila = await prisma.aiTrace.findFirst({
      where: { projectId, chatMessageId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { chatMessageId: true },
    });
    return fila?.chatMessageId ?? null;
  } catch (error) {
    console.error('[ai/trace] no se pudo resolver el chatMessageId del turno padre (no bloqueante):', error);
    return null;
  }
}

/**
 * odd/tasks/motor-claude.md (T11): vincula una tanda de filas de
 * `TokenUsage` (las de las pasadas EN PARALELO del verificador, que ya se
 * crearon antes de que esta traza existiera) a la traza recién creada —
 * mismo problema de orden que `vincularTrazaAMensaje`, resuelto igual (un
 * UPDATE chico después). Ver el comentario de `AiTrace.tokenUsagesDeLaRonda`
 * en el schema: relación 1:N aparte de `tokenUsageId` (que sigue siendo
 * 1:1). Vacío o ya vinculado no hace ningún UPDATE de más.
 */
export async function vincularUsosALaRonda(aiTraceId: string, tokenUsageIds: readonly string[]): Promise<void> {
  const ids = tokenUsageIds.filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  try {
    await prisma.tokenUsage.updateMany({ where: { id: { in: ids } }, data: { aiTraceId } });
  } catch (error) {
    console.error('[ai/trace] no se pudieron vincular los TokenUsage de la ronda (no bloqueante):', error);
  }
}

/**
 * odd/tasks/motor-claude.md (T11): la VERIFICATION más reciente de este
 * proyecto que disparó al menos una bandera roja determinística, si corrió
 * hace poco (`VENTANA_BANDERA_ROJA_MS`) — para que la corrección que sigue
 * pueda marcar `redFlagsFixed`. La ventana de tiempo es una heurística
 * honesta (no hay un id de "ronda" compartido entre verificación y
 * corrección, sólo proximidad): larga de sobra para el flujo real (la
 * corrección llega segundos después de la verificación, nunca minutos),
 * corta de sobra para no mezclar con una verificación de un turno anterior.
 */
const VENTANA_BANDERA_ROJA_MS = 5 * 60_000;

export async function banderaRojaRecienteSinFijar(projectId: string): Promise<string[] | null> {
  try {
    const fila = await prisma.aiTrace.findFirst({
      where: {
        projectId,
        turnKind: 'VERIFICATION',
        redFlags: { not: null },
        createdAt: { gte: new Date(Date.now() - VENTANA_BANDERA_ROJA_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { redFlags: true },
    });
    if (!fila?.redFlags) return null;
    return fila.redFlags.split(',').filter(Boolean);
  } catch (error) {
    console.error('[ai/trace] no se pudo leer la última bandera roja (no bloqueante):', error);
    return null;
  }
}
