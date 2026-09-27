import { prisma } from '../db.ts';
import { hasResendApiKey } from '../env.ts';
import { organizacionParaEmail } from './resolucion.ts';

/**
 * odd/tasks/organizaciones.md (T2): fuente única de verdad de "¿este email
 * está confiado?" — la usan el registro con contraseña, el login y el
 * callback de Google para decidir si vale la pena intentar
 * `unirSiCorresponde`, y T3 la va a reusar para el flujo de Resend.
 *
 * Fallback sin Resend (decisión del dueño): mientras no haya
 * `RESEND_API_KEY` en el entorno, toda cuenta se toma como verificada — así
 * que un `emailVerifiedAt` nulo NO alcanza para decir "no confiable": hay
 * que mirar si Resend está siquiera configurado.
 */
export function emailConfiable(user: { emailVerifiedAt: Date | null }): boolean {
  if (user.emailVerifiedAt !== null) return true;
  return !hasResendApiKey();
}

/**
 * "Unirse ocurre en el momento" (decisión del dueño): se llama después del
 * registro con contraseña, después del login con contraseña y después del
 * login/registro con Google — nunca mueve a quien YA tiene organización (un
 * docente pertenece a UNA sola, decisión del dueño), nunca toca a la demo, y
 * nunca une a quien todavía no es confiable. Idempotente: llamarla de más no
 * hace nada raro, sólo confirma el estado actual.
 *
 * Si el email resuelve a una `NETWORK` (dominio compartido por varias
 * sedes), esta función NO elige una sede por su cuenta — la persona queda
 * personal hasta que el picker de T4 la una a una sede concreta.
 *
 * Devuelve el `organizationId` resultante (el de siempre si no había nada
 * para hacer, o el recién asignado) para que el llamador pueda armar la
 * sesión sin pedir el usuario de nuevo.
 */
export async function unirSiCorresponde(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, organizationId: true, isDemo: true, emailVerifiedAt: true },
  });
  if (!user) return null;
  if (user.isDemo || user.organizationId !== null) return user.organizationId;
  if (!emailConfiable(user)) return null;

  const resolucion = await organizacionParaEmail(user.email);
  if (!resolucion || 'red' in resolucion) return null;

  const actualizado = await prisma.user.update({
    where: { id: user.id },
    data: { organizationId: resolucion.campus.id },
    select: { organizationId: true },
  });
  return actualizado.organizationId;
}
