import type { APIRoute } from 'astro';
import { fail, ok } from '../../../lib/http.ts';
import { getEnv, billingNow } from '../../../lib/env.ts';
import { enviarRecordatoriosDeRenovacion } from '../../../lib/billing/recordatorios.ts';

/**
 * POST /api/internal/recordatorios-renovacion (odd/tasks/planes-y-cobros.md
 * T4b): dispara a mano los avisos de renovación de 30/7 días — pensado para
 * un cron externo (`curl -X POST -H "x-internal-secret: $INTERNAL_CRON_SECRET"
 * https://.../api/internal/recordatorios-renovacion`), por si nadie entra al
 * superadmin ese día (`AdminLayout.astro` ya lo dispara perezosamente en
 * cada carga de `/admin/**`, pero eso depende de que alguien visite el
 * panel). Fuera del middleware de sesión a propósito (un cron no tiene
 * cookie) — se protege con un secreto compartido en vez de un rol.
 *
 * Documentado acá porque no hay ningún cron ya configurado en este repo: el
 * dueño (o quien despliegue) tiene que dar de alta esta llamada en su
 * scheduler (cron de Linux, GitHub Actions, Coolify, etc.) con la frecuencia
 * que prefiera — una vez por día alcanza de sobra (la idempotencia de
 * `RenewalReminder` hace que llamarlo más seguido no mande mails de más).
 */
export const POST: APIRoute = async ({ request }) => {
  const env = getEnv();
  if (!env.INTERNAL_CRON_SECRET) {
    return fail('No configurado: falta INTERNAL_CRON_SECRET.', 503);
  }

  const secreto = request.headers.get('x-internal-secret');
  if (secreto !== env.INTERNAL_CRON_SECRET) {
    return fail('No autorizado.', 401);
  }

  const resultado = await enviarRecordatoriosDeRenovacion(billingNow());
  return ok({ enviados: resultado.enviados });
};
