/**
 * Taller de ideas (odd/tasks/taller-de-ideas.md): lectura de las charlas y
 * los chequeos que comparten todas las rutas de `/api/taller`.
 */

import { prisma } from '../db.ts';
import { resolverAccesoIa, mensajeAccesoIa } from '../orgs/acceso.ts';
import { leerAppSettings } from '../settings.ts';
import { consumoDeLaDemo } from '../demo.ts';
import { consumedTokens } from '../ai/usage.ts';
import { fail } from '../http.ts';
import type { ProviderConfig } from '../ai/provider.ts';
import type { SessionUser } from '../auth/session.ts';
import { leerFichaGuardada, leerIdeasGuardadas, leerPreguntasGuardadas } from './ficha.ts';
import { APERTURAS, type ModoTaller } from './prompt.ts';
import type { MensajeTaller, SesionTaller } from './tipos.ts';

/**
 * ¿Puede esta cuenta usar el Taller? Es la MISMA regla que el editor
 * (`resolverAccesoIa` + el interruptor de la demo): el Taller gasta IA igual
 * que crear un recurso. `null` = puede; si no, la respuesta de error lista
 * para devolver.
 *
 * odd/tasks/planes-y-cobros.md (T10, defecto encontrado): antes usaba el
 * `puedeUsarLaIa` booleano con un mensaje genérico fijo — una cuenta
 * personal sin créditos veía "no tenés habilitado el uso de la IA" en vez
 * del mensaje real ("Te quedaste sin créditos..."), y el cuerpo no traía
 * `reason`. Ahora usa `resolverAccesoIa` + `mensajeAccesoIa`, igual que
 * `chat/stream.ts`, `verificar.ts` y `autocorreccion.ts` — un solo criterio
 * de acceso a la IA en toda la app.
 */
export async function chequearAccesoTaller(user: SessionUser): Promise<Response | null> {
  const acceso = await resolverAccesoIa(user);
  if (!acceso.allowed) {
    return fail(mensajeAccesoIa(acceso), 403, { reason: acceso.reason });
  }

  if (user.isDemo) {
    const settings = await leerAppSettings();
    if (!settings.demoEnabled) return fail('La demo está cerrada por el momento.', 403);
  }

  return null;
}

/**
 * Los topes de consumo, ANTES de gastar: el global de la demo y el del
 * docente en este motor. Mismos criterios y mismos textos que
 * `api/chat/stream.ts`, sin ofrecer "cambiá de motor" (el Taller no tiene
 * selector: usa siempre el motor predeterminado).
 */
export async function chequearTopes(user: SessionUser, motor: ProviderConfig): Promise<Response | null> {
  if (user.isDemo) {
    const settings = await leerAppSettings();
    if ((await consumoDeLaDemo()) >= settings.demoTokenLimit) {
      return fail(
        'La demo ya usó todo el crédito de esta ronda. Si querés seguir, creá tu cuenta: es gratis y tus ideas quedan guardadas.',
        429,
        { registerUrl: '/register' },
      );
    }
  }

  if (motor.userTokenLimit > 0) {
    const usados = await consumedTokens(user.id, motor.id, motor.userTokenWindowHours);
    if (usados >= motor.userTokenLimit) {
      return fail(
        motor.userTokenWindowHours > 0
          ? 'Por ahora usaste todo tu cupo de IA. Se va reponiendo solo con las horas: probá de nuevo más tarde.'
          : 'Usaste todo tu cupo de IA. Pedile más a la administración de tu escuela.',
        429,
      );
    }
  }

  return null;
}

/** La charla, sólo si es de este docente. Un admin tampoco ve charlas ajenas. */
export async function buscarSesionPropia(sessionId: string, userId: string) {
  return prisma.ideaSession.findFirst({ where: { id: sessionId, userId } });
}

export function mensajeParaCliente(fila: {
  id: string;
  role: string;
  content: string;
  questions: string | null;
  proposals: string | null;
  attachments: string | null;
}): MensajeTaller {
  let attachments: string[] = [];
  try {
    attachments = fila.attachments ? (JSON.parse(fila.attachments) as string[]) : [];
  } catch {
    attachments = [];
  }

  return {
    id: fila.id,
    role: fila.role === 'user' ? 'user' : 'assistant',
    content: fila.content,
    questions: leerPreguntasGuardadas(fila.questions),
    proposals: leerIdeasGuardadas(fila.proposals),
    attachments,
  };
}

/** La charla entera, lista para la isla de React. `null` si no es de este docente. */
export async function sesionParaCliente(sessionId: string, userId: string): Promise<SesionTaller | null> {
  const fila = await prisma.ideaSession.findFirst({
    where: { id: sessionId, userId },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      assets: { orderBy: { createdAt: 'asc' }, select: { id: true, filename: true, url: true, fileType: true } },
    },
  });
  if (!fila) return null;

  return {
    id: fila.id,
    mode: fila.mode,
    title: fila.title,
    brief: leerFichaGuardada(fila.brief),
    finalPrompt: fila.finalPrompt,
    description: fila.description,
    projectId: fila.projectId,
    messages: fila.messages.map(mensajeParaCliente),
    assets: fila.assets,
  };
}

/** Crea una charla con la apertura fija de su puerta como primer mensaje. */
export async function crearSesion(userId: string, modo: ModoTaller) {
  const apertura = APERTURAS[modo];
  return prisma.ideaSession.create({
    data: {
      userId,
      mode: modo,
      messages: {
        create: {
          role: 'assistant',
          content: apertura.content,
          questions: JSON.stringify(apertura.questions),
        },
      },
    },
    select: { id: true },
  });
}

/**
 * Turnos del Taller corriendo AHORA en este proceso, por charla. Evita que
 * dos pestañas (o un doble clic) contesten la misma charla a la vez: el
 * segundo turno recibe 409. En memoria a propósito, mismo criterio que
 * `ai/turnos-en-curso.ts`: un solo proceso sirve la app, y un reinicio
 * (deploy) corta el turno igual.
 */
const turnosEnCurso = new Set<string>();

export function reclamarTurno(sessionId: string): boolean {
  if (turnosEnCurso.has(sessionId)) return false;
  turnosEnCurso.add(sessionId);
  return true;
}

export function liberarTurno(sessionId: string): void {
  turnosEnCurso.delete(sessionId);
}

export function hayTurnoEnCurso(sessionId: string): boolean {
  return turnosEnCurso.has(sessionId);
}
