import type { APIRoute } from 'astro';
import { asegurarCuentaDemo } from '../../../lib/demo.ts';
import { leerAppSettings } from '../../../lib/settings.ts';
import { createSessionToken, setSessionCookie, type SessionUser } from '../../../lib/auth/session.ts';

/**
 * POST /api/auth/demo — entrada a la cuenta compartida de demo (design.md
 * §8; specs/demo-mode/spec.md).
 *
 * Recibe el `<form method="POST">` discreto de `login.astro`: sin body,
 * sin CSRF adicional (mismo origen, form-urlencoded — cubierto por
 * `src/lib/csrf.ts`, igual que cualquier otro POST de formulario del repo).
 *
 * 404, NO 403, cuando la demo está apagada: un 403 confirmaría que la ruta
 * existe; un 404 no delata nada mientras la puerta está cerrada.
 */
export const POST: APIRoute = async ({ cookies, redirect }) => {
  const settings = await leerAppSettings();
  if (!settings.demoEnabled) {
    return new Response('Not found', { status: 404 });
  }

  const cuenta = await asegurarCuentaDemo();

  // El JWT sólo firma identidad (session.ts); `aiAccessOverride`/`isDemo`
  // viajan acá sólo para la respuesta inmediata — el middleware los vuelve a
  // leer de la base en el próximo pedido a una ruta gateada, como con
  // cualquier otra cuenta.
  const session: SessionUser = {
    id: cuenta.id,
    email: cuenta.email,
    name: cuenta.name,
    role: cuenta.role,
    aiAccessOverride: cuenta.aiAccessOverride,
    isDemo: cuenta.isDemo,
    primeAccess: cuenta.primeAccess,
  };

  // 2 horas, no las 168h por defecto de una cuenta real: la demo es de
  // paso, y una sesión larga sólo prolonga una pestaña olvidada abierta.
  const DEMO_TTL_SECONDS = 2 * 60 * 60;
  const token = await createSessionToken(session, DEMO_TTL_SECONDS);
  setSessionCookie(cookies, token, DEMO_TTL_SECONDS);

  return redirect('/app', 302);
};
