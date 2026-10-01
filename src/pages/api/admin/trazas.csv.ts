import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../lib/auth/guards.ts';
import { filaCsv } from '../../../lib/admin/csv.ts';
import { COLUMNAS_EXPORT_TRAZAS, filasExportTrazas, parsearFiltroQuery, type FilaTrazaExport } from '../../../lib/admin/trazas.ts';

/**
 * GET /api/admin/trazas.csv?desde=&hasta=&plan=&model= —
 * odd/tasks/ahorro-tokens.md (T4): mismo patrón que
 * `/api/admin/metricas.csv` (archivo hermano) — `requireAdmin` explícito
 * aunque el middleware ya lo exige en todo `/api/admin/**`, porque es una
 * descarga de datos.
 */

const ENCABEZADO: Record<keyof FilaTrazaExport, string> = {
  traceId: 'ID de traza',
  createdAt: 'Fecha (UTC)',
  userPseudo: 'Docente (pseudónimo)',
  orgPseudo: 'Organización (pseudónimo)',
  plan: 'Plan',
  turnKind: 'Tipo de turno',
  model: 'Motor',
  reasoningEffort: 'Razonamiento',
  requestText: 'Pedido del docente',
  editOutcome: 'Resultado de edición',
  retries: 'Reintentos',
  truncated: 'Truncado',
  htmlCharsBefore: 'Caracteres HTML antes',
  htmlCharsAfter: 'Caracteres HTML después',
  durationMs: 'Duración (ms)',
  promptTokens: 'Tokens de entrada',
  completionTokens: 'Tokens de salida',
  cachedInputTokens: 'Tokens cacheados',
  costUsd: 'Costo USD',
  selfTestPassed: 'Autopruebas OK',
  selfTestFailed: 'Autopruebas falladas',
  correctionRounds: 'Ronda de corrección',
  verifierFindings: 'Hallazgos del verificador',
  faceRating: 'Carita',
  faceRatingComment: '¿Qué falló? (comentario)',
  inlineQuestionKind: 'Pregunta mostrada',
  inlineQuestionAnswer: 'Respuesta a la pregunta',
  suspectedDefect: 'Defecto sospechado',
  suspectedDefectPhrase: 'Frase que lo disparó',
  undoneSignal: 'Se deshizo',
  codeEditedByTeacherSignal: 'Docente editó el código a mano',
};

export const GET: APIRoute = async ({ url, locals }) => {
  const actor = requireAdmin(locals);
  if (actor instanceof Response) return actor;

  const filtro = parsearFiltroQuery(url.searchParams);
  const filas = await filasExportTrazas(filtro);

  const lineas = [
    filaCsv(COLUMNAS_EXPORT_TRAZAS.map((columna) => ENCABEZADO[columna])),
    ...filas.map((fila) => filaCsv(COLUMNAS_EXPORT_TRAZAS.map((columna) => fila[columna] as string | number | boolean | null))),
  ];
  const csv = `${lineas.join('\r\n')}\r\n`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="kodu-trazas-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
};
