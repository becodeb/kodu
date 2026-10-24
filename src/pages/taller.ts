import type { APIRoute } from 'astro';
import { getEnv } from '../lib/env.ts';
import { rutaDeInvitacionDelTaller } from '../lib/taller/atajo.ts';

/**
 * GET /taller — redirige al enlace de invitación del taller presencial
 * (`TALLER_INVITE_URL`, ver src/lib/taller/atajo.ts). Sin enlace cargado, o
 * con uno que no tiene forma de invitación, vuelve al inicio.
 *
 * `no-store`: cuando el enlace se revoca y se carga otro, ningún navegador
 * puede quedarse con el destino viejo.
 */
export const GET: APIRoute = () => {
  const destino = rutaDeInvitacionDelTaller(getEnv().TALLER_INVITE_URL) ?? '/';
  return new Response(null, {
    status: 302,
    headers: { Location: destino, 'Cache-Control': 'no-store' },
  });
};
