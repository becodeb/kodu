import { prisma } from '../db.ts';
import { fingerprintHtml } from './fingerprint.ts';
import { decidirResumenChequeosPosteriores, POST_CHECKS_CLAIM_STALE_MS } from './post-checks.ts';

export interface ChequeosPosterioresPendientes {
  messageId: string;
  /** La huella de `Project.currentHtml` EN ESTE MOMENTO — la misma que hay
   *  que devolver en `complete` para que no se marque un HTML que ya dejó
   *  de ser el vigente (`marcarChequeosPosteriores`). */
  fingerprint: string;
  /** El HTML de ANTES de este turno (`ProjectSnapshot.html`): el cliente lo
   *  necesita para decidir `tipo` ('nuevo'/'ajuste') del verificador,
   *  exactamente como ya hace un turno normal con `htmlAlInicioDelTurno`
   *  (`decidirTipoVerificacion`, `lib/client/verificador.ts`). */
  htmlAntes: string;
}

/**
 * T5: si el turno MÁS NUEVO (de cualquier hilo del proyecto — mismo alcance
 * que `Project.currentHtml`, ver `hayTurnoEnCurso`/`checklistActual`) que
 * cambió el HTML todavía no pasó por el self-test/corrección/verificador del
 * navegador, esto lo devuelve. `null` si no corresponde: no hay ningún turno
 * que haya cambiado el HTML, ya se marcó, la huella ya no coincide, o otra
 * pestaña lo tiene reclamado hace poco (`decidirResumenChequeosPosteriores`).
 *
 * Reusada por `project/[id].astro` (carga inicial de la página) Y por
 * `GET /api/projects/:id/threads` (el mismo pedido que ya usa el cliente
 * para reanudar un turno que quedó corriendo, T4) — un turno recién
 * reanudado también puede necesitar esto apenas termina.
 */
export async function pendienteChequeosPosteriores(
  projectId: string,
): Promise<ChequeosPosterioresPendientes | null> {
  const [project, candidato] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { currentHtml: true } }),
    prisma.chatMessage.findFirst({
      where: { thread: { projectId }, role: 'assistant', undoneAt: null, snapshot: { isNot: null } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        postChecksAt: true,
        postChecksClaimedAt: true,
        resultHtmlFingerprint: true,
        snapshot: { select: { html: true } },
      },
    }),
  ]);
  if (!project || !candidato) return null;

  const huellaActual = fingerprintHtml(project.currentHtml);
  const decision = decidirResumenChequeosPosteriores(
    {
      resultHtmlFingerprint: candidato.resultHtmlFingerprint,
      postChecksAt: candidato.postChecksAt,
      postChecksClaimedAt: candidato.postChecksClaimedAt,
    },
    huellaActual,
    Date.now(),
  );
  if (decision.accion !== 'correr') return null;

  return { messageId: candidato.id, fingerprint: huellaActual, htmlAntes: candidato.snapshot!.html };
}

/**
 * Reclamo atómico (T5, "claim it server-side ... so only one browser does
 * it"): vuelve a evaluar TODA la elegibilidad server-side (nunca confía en
 * lo que ya decidió el cliente al cargar la página, que pudo quedar viejo)
 * y sólo entonces intenta el UPDATE condicional. Dos reclamos concurrentes
 * sobre la misma fila quedan serializados por Postgres: al segundo, cuando
 * le toca correr, la condición del WHERE ya no vale (el primero ya puso un
 * `postChecksClaimedAt` reciente) y su `updateMany` afecta 0 filas — "el
 * primero que actualiza gana", sin necesidad de una transacción explícita.
 */
export async function reclamarChequeosPosteriores(projectId: string, messageId: string): Promise<boolean> {
  const pendiente = await pendienteChequeosPosteriores(projectId);
  if (!pendiente || pendiente.messageId !== messageId) return false;

  const limite = new Date(Date.now() - POST_CHECKS_CLAIM_STALE_MS);
  const resultado = await prisma.chatMessage.updateMany({
    where: {
      id: messageId,
      postChecksAt: null,
      OR: [{ postChecksClaimedAt: null }, { postChecksClaimedAt: { lt: limite } }],
    },
    data: { postChecksClaimedAt: new Date() },
  });
  return resultado.count === 1;
}

/**
 * Marca el turno como chequeado. La llama el cliente al terminar el
 * pipeline (turno normal o reanudado) Y `stream.ts` mismo, en el momento,
 * para un turno de versiones (T2: nunca corre el pipeline —lo saltea "by
 * design"— así que se marca de una para que jamás aparezca como pendiente).
 *
 * Gateada por la MISMA huella contra staleness que
 * `/api/chat/autocorreccion`/`/api/chat/verificar`: si `Project.currentHtml`
 * ya cambió (otro turno más nuevo, una edición a mano), no se marca nada. El
 * turno sigue "sin marcar" — aunque, al dejar de ser "el más nuevo", en la
 * práctica ya nunca se lo vuelve a elegir como candidato de todos modos.
 */
export async function marcarChequeosPosteriores(args: {
  projectId: string;
  messageId: string;
  fingerprint: string;
}): Promise<boolean> {
  const project = await prisma.project.findUnique({ where: { id: args.projectId }, select: { currentHtml: true } });
  if (!project || fingerprintHtml(project.currentHtml) !== args.fingerprint) return false;

  await prisma.chatMessage.update({
    where: { id: args.messageId },
    data: { postChecksAt: new Date(), resultHtmlFingerprint: args.fingerprint },
  });
  return true;
}
