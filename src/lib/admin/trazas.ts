import { prisma } from '../db.ts';
import { getEnv } from '../env.ts';
import { pseudonimizar } from './pseudonimizar.ts';

/**
 * odd/tasks/ahorro-tokens.md (T4): filtro y forma de fila compartidos entre
 * el export JSON y el CSV — un solo lugar decide QUÉ sale (nunca el HTML,
 * nunca un email/nombre crudo) y los dos formatos lo leen igual.
 */

export interface FiltroTrazas {
  desde?: Date;
  hasta?: Date;
  plan?: 'FREE' | 'INDIVIDUAL' | 'ORG';
  model?: string;
}

export interface FilaTrazaExport {
  traceId: string;
  createdAt: string;
  userPseudo: string;
  orgPseudo: string | null;
  plan: string;
  turnKind: string;
  model: string;
  reasoningEffort: string | null;
  requestText: string;
  editOutcome: string | null;
  retries: number;
  truncated: boolean;
  htmlCharsBefore: number | null;
  htmlCharsAfter: number | null;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedInputTokens: number | null;
  costUsd: string | null;
  selfTestPassed: number | null;
  selfTestFailed: number | null;
  correctionRounds: number | null;
  verifierFindings: number | null;
  faceRating: string | null;
  faceRatingComment: string | null;
  inlineQuestionKind: string | null;
  inlineQuestionAnswer: string | null;
  suspectedDefect: boolean;
  suspectedDefectPhrase: string | null;
  undoneSignal: boolean;
  codeEditedByTeacherSignal: boolean;
}

export const COLUMNAS_EXPORT_TRAZAS: Array<keyof FilaTrazaExport> = [
  'traceId',
  'createdAt',
  'userPseudo',
  'orgPseudo',
  'plan',
  'turnKind',
  'model',
  'reasoningEffort',
  'requestText',
  'editOutcome',
  'retries',
  'truncated',
  'htmlCharsBefore',
  'htmlCharsAfter',
  'durationMs',
  'promptTokens',
  'completionTokens',
  'cachedInputTokens',
  'costUsd',
  'selfTestPassed',
  'selfTestFailed',
  'correctionRounds',
  'verifierFindings',
  'faceRating',
  'faceRatingComment',
  'inlineQuestionKind',
  'inlineQuestionAnswer',
  'suspectedDefect',
  'suspectedDefectPhrase',
  'undoneSignal',
  'codeEditedByTeacherSignal',
];

/**
 * Las trazas del rango/filtro pedido, ya pseudonimizadas — nunca un email,
 * nunca un nombre, nunca el HTML (la tabla ni lo guarda). `requestText` SÍ
 * viaja tal cual (decisión del dueño, texto de la tarea: "Request text IS
 * included").
 */
export async function filasExportTrazas(filtro: FiltroTrazas): Promise<FilaTrazaExport[]> {
  const secreto = getEnv().AUTH_SECRET;

  const filas = await prisma.aiTrace.findMany({
    where: {
      ...(filtro.desde || filtro.hasta
        ? { createdAt: { ...(filtro.desde ? { gte: filtro.desde } : {}), ...(filtro.hasta ? { lte: filtro.hasta } : {}) } }
        : {}),
      ...(filtro.plan ? { planAtCall: filtro.plan } : {}),
      ...(filtro.model ? { model: filtro.model } : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      createdAt: true,
      userId: true,
      organizationId: true,
      planAtCall: true,
      turnKind: true,
      model: true,
      reasoningEffort: true,
      requestText: true,
      editOutcome: true,
      retries: true,
      truncated: true,
      htmlCharsBefore: true,
      htmlCharsAfter: true,
      durationMs: true,
      selfTestPassed: true,
      selfTestFailed: true,
      correctionRounds: true,
      verifierFindings: true,
      faceRating: true,
      faceRatingComment: true,
      inlineQuestionKind: true,
      inlineQuestionAnswer: true,
      suspectedDefect: true,
      suspectedDefectPhrase: true,
      undoneSignal: true,
      codeEditedByTeacherSignal: true,
      tokenUsage: {
        select: { promptTokens: true, completionTokens: true, cachedInputTokens: true, costUsd: true },
      },
    },
  });

  return filas.map((fila) => ({
    traceId: fila.id,
    createdAt: fila.createdAt.toISOString(),
    userPseudo: pseudonimizar(fila.userId, secreto, 'docente'),
    orgPseudo: fila.organizationId ? pseudonimizar(fila.organizationId, secreto, 'org') : null,
    plan: fila.planAtCall,
    turnKind: fila.turnKind,
    model: fila.model,
    reasoningEffort: fila.reasoningEffort,
    requestText: fila.requestText,
    editOutcome: fila.editOutcome,
    retries: fila.retries,
    truncated: fila.truncated,
    htmlCharsBefore: fila.htmlCharsBefore,
    htmlCharsAfter: fila.htmlCharsAfter,
    durationMs: fila.durationMs,
    promptTokens: fila.tokenUsage?.promptTokens ?? null,
    completionTokens: fila.tokenUsage?.completionTokens ?? null,
    cachedInputTokens: fila.tokenUsage?.cachedInputTokens ?? null,
    costUsd: fila.tokenUsage?.costUsd?.toString() ?? null,
    selfTestPassed: fila.selfTestPassed,
    selfTestFailed: fila.selfTestFailed,
    correctionRounds: fila.correctionRounds,
    verifierFindings: fila.verifierFindings,
    faceRating: fila.faceRating,
    faceRatingComment: fila.faceRatingComment,
    inlineQuestionKind: fila.inlineQuestionKind,
    inlineQuestionAnswer: fila.inlineQuestionAnswer,
    suspectedDefect: fila.suspectedDefect,
    suspectedDefectPhrase: fila.suspectedDefectPhrase,
    undoneSignal: fila.undoneSignal,
    codeEditedByTeacherSignal: fila.codeEditedByTeacherSignal,
  }));
}

/** Para el `<select>` de modelo del panel de admin: sólo los que de verdad
 *  tienen alguna traza, no el catálogo entero. */
export async function modelosConTrazas(): Promise<string[]> {
  const filas = await prisma.aiTrace.findMany({ distinct: ['model'], select: { model: true }, orderBy: { model: 'asc' } });
  return filas.map((fila) => fila.model);
}

function parsearFiltroQuery(searchParams: URLSearchParams): FiltroTrazas {
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');
  const plan = searchParams.get('plan');
  const model = searchParams.get('model');
  return {
    desde: desde ? new Date(desde) : undefined,
    hasta: hasta ? new Date(hasta) : undefined,
    plan: plan === 'FREE' || plan === 'INDIVIDUAL' || plan === 'ORG' ? plan : undefined,
    model: model || undefined,
  };
}

export { parsearFiltroQuery };
