import { z } from 'zod';

/**
 * Acceso centralizado y validado a las variables de entorno del servidor.
 *
 * Se lee de forma perezosa (no en el import) a proposito: durante `astro build`
 * dentro de Docker todavia no hay `.env` inyectado, y no queremos romper el build
 * por eso. La validacion ocurre en el primer request real.
 */

// Astro/Vite exponen el .env en `import.meta.env`. En Node puro (seed, scripts
// de CLI) esa propiedad no existe, por eso el fallback.
const viteEnv = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ??
  {}) as Record<string, string | undefined>;

function read(key: string): string | undefined {
  const value = process.env[key] ?? viteEnv[key];
  return value === '' ? undefined : value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),

  AUTH_SECRET: z
    .string()
    .min(32, 'AUTH_SECRET debe tener al menos 32 caracteres (firma de sesiones)'),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),

  ALLOWED_EMAIL_DOMAINS: z.string().default(''),
  ADMIN_EMAILS: z.string().default(''),

  PUBLIC_SITE_URL: z.string().min(1).default('http://localhost:3000'),
  UPLOADS_DIR: z.string().min(1).default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(10),

  /**
   * Motor de IA. Hay tres proveedores y el docente elige cuál usa.
   *
   * ALPHA y MINIMAX son gratuitos, multimodales y sin cupo. DEEPSEEK se paga
   * por token, así que trae tope por usuario — sin ese tope, un docente solo
   * puede vaciar la cuenta en una tarde.
   *
   * Las claves NO son obligatorias para arrancar (la galería y el editor andan
   * igual): se validan recién al invocar el chat.
   */
  AI_ALPHA_API_KEY: z.string().default(''),
  AI_ALPHA_BASE_URL: z.string().min(1).default('https://openrouter.ai/api'),
  AI_ALPHA_MODEL: z.string().min(1).default('stealth/ox-alpha'),

  AI_DEEPSEEK_API_KEY: z.string().default(''),
  AI_DEEPSEEK_BASE_URL: z.string().min(1).default('https://api.deepseek.com'),
  AI_DEEPSEEK_MODEL: z.string().min(1).default('deepseek-v4-flash'),

  AI_MINIMAX_API_KEY: z.string().default(''),
  AI_MINIMAX_BASE_URL: z.string().min(1).default('https://api.gmi-serving.com'),
  AI_MINIMAX_MODEL: z.string().min(1).default('MiniMaxAI/MiniMax-M3'),
  /**
   * Respaldo del principal, en el MISMO proveedor. Se prueba antes de tocar
   * DeepSeek, que es el unico que se paga.
   */
  AI_MINIMAX_FALLBACK_MODEL: z.string().min(1).default('MiniMaxAI/MiniMax-M2.7'),

  /**
   * Tope de tokens de UNA respuesta. Alto a propósito: el contrato obliga a la
   * IA a devolver el documento HTML completo en cada edición, y si se queda
   * corta el recurso vuelve cortado por la mitad. El tope existe para que una
   * respuesta desbocada no coma la memoria del servidor, no para ahorrar.
   */
  AI_ALPHA_MAX_TOKENS: z.coerce.number().int().positive().default(65_536),
  AI_DEEPSEEK_MAX_TOKENS: z.coerce.number().int().positive().default(8_192),
  AI_MINIMAX_MAX_TOKENS: z.coerce.number().int().positive().default(65_536),

  /**
   * Tope ACUMULADO por usuario, en tokens. 0 = sin tope.
   * Alpha y MiniMax son gratis, así que no llevan; DeepSeek sí.
   */
  AI_ALPHA_USER_TOKEN_LIMIT: z.coerce.number().int().min(0).default(0),
  AI_DEEPSEEK_USER_TOKEN_LIMIT: z.coerce.number().int().min(0).default(300_000),
  AI_MINIMAX_USER_TOKEN_LIMIT: z.coerce.number().int().min(0).default(0),

  /**
   * Largo máximo de UN mensaje del docente, en caracteres.
   *
   * No está para racionar: está para que el pedido entre en la ventana de
   * contexto del modelo junto con el HTML del recurso y el historial. Alpha y
   * MiniMax tienen 1M de tokens de contexto, asi que su tope es holgado;
   * DeepSeek es mucho mas chico y ahi si conviene avisar antes del rechazo.
   */
  AI_ALPHA_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(400_000),
  AI_DEEPSEEK_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(24_000),
  AI_MINIMAX_MAX_INPUT_CHARS: z.coerce.number().int().positive().default(400_000),

  /**
   * Google Sign-In. Vacias = el boton no se muestra y solo queda el ingreso con
   * correo y contrasena, asi un entorno sin configurar no muestra un boton roto.
   */
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),

  /**
   * odd/tasks/organizaciones.md (T2, usada de lleno en T3): cliente de Resend
   * por `fetch` (sin dependencia nueva) para el mail de verificación del
   * registro con contraseña. Vacía = fallback "sin Resend": toda cuenta
   * nueva se toma como verificada (`emailVerificationSource = 'NO_PROVIDER'`,
   * ver `src/lib/orgs/membresia.ts#emailConfiable`) — decisión del dueño.
   */
  RESEND_API_KEY: z.string().default(''),
  /**
   * odd/tasks/organizaciones.md (T3): remitente exigido por Resend
   * ("Nombre <direccion@dominio>"). Sólo hace falta si `RESEND_API_KEY`
   * tiene valor — ver `src/lib/email/resend.ts#enviarEmail`, que loguea un
   * error y trata el envío como fallido en vez de explotar si falta.
   */
  RESEND_FROM: z.string().default(''),
  /**
   * odd/tasks/organizaciones.md (T3): sólo para los e2e (`e2e/verificacion-email.ts`)
   * — apunta el cliente a un mock local en vez de `https://api.resend.com`.
   * Vacía = la URL real de Resend.
   */
  RESEND_API_URL: z.string().default(''),

  /** Si los modelos multimodales reciben adjuntos (formato OpenAI `image_url`). */
  AI_VISION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /**
   * Clave de cifrado de las API keys del catálogo (`AiModel.apiKeyCipher`),
   * AES-256-GCM: 32 bytes en hexadecimal (64 caracteres).
   *
   * Se valida perezosamente DENTRO de `src/lib/crypto/secretos.ts`, no acá:
   * una instancia sin ningún motor cargado todavía tiene que poder arrancar
   * igual. Separada de AUTH_SECRET a propósito — rotar una no debe forzar a
   * rotar la otra (ver design.md §4).
   */
  KODU_ENCRYPTION_KEY: z.string().default(''),

  /**
   * odd/tasks/planes-y-cobros.md (T4): qué adaptador de `PaymentGateway` usa
   * el servidor (`src/lib/billing/pasarela/`). `simulado` es el default —
   * anda sin ninguna credencial, pensado para dev y los e2e. En producción,
   * si queda en `simulado` (o si `mercadopago` no tiene `MP_ACCESS_TOKEN`
   * cargado), los endpoints de checkout se niegan con un error claro: nunca
   * se simula un cobro real en silencio (decisión de esta tarea).
   */
  BILLING_PROVIDER: z.enum(['simulado', 'mercadopago']).default('simulado'),
  /** Access token de la cuenta de Mercado Pago (Credenciales de producción o
   *  de prueba, según el entorno). Vacío = el adaptador `mercadopago` no
   *  puede operar. */
  MP_ACCESS_TOKEN: z.string().default(''),
  /** Clave secreta de la firma de webhooks de Mercado Pago ("Tus
   *  integraciones" → esa aplicación → Webhooks → clave secreta), usada para
   *  validar `x-signature`. Vacía = el webhook NO valida firma (sólo debería
   *  quedar vacía en un entorno sin la app de Mercado Pago configurada
   *  todavía; nunca en producción). */
  MP_WEBHOOK_SECRET: z.string().default(''),
  /**
   * SOLO para los e2e (`e2e/planes-cobro.ts`): "ahora" fijo que reemplaza a
   * `new Date()` en los cálculos de ciclo lectivo (`ciclo.ts#firstCharge`) al
   * contratar una licencia por CICLO — así el e2e puede probar un alta en
   * cualquier mes del año sin esperar al calendario real. Fecha ISO
   * ("2026-10-05T12:00:00Z"). Se ignora por completo salvo que
   * `BILLING_PROVIDER=simulado` Y `NODE_ENV` no sea `production` (ver
   * `billingNow()` más abajo) — imposible de activar en producción incluso
   * si alguien la carga por error.
   */
  BILLING_FAKE_NOW: z.string().default(''),

  /**
   * odd/tasks/planes-y-cobros.md (T4b): secreto que protege
   * `/api/internal/recordatorios-renovacion` — el disparo PEREZOSO de los
   * avisos de renovación (`src/lib/billing/recordatorios.ts`) ya corre solo
   * con cada carga de `/admin/**`, pero este endpoint deja que un cron
   * externo lo dispare también (p.ej. de madrugada, sin esperar a que alguien
   * entre al superadmin). Vacío = el endpoint se niega siempre (fail-closed:
   * nunca queda abierto sin secreto).
   */
  INTERNAL_CRON_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse({
    NODE_ENV: read('NODE_ENV'),
    DATABASE_URL: read('DATABASE_URL'),
    AUTH_SECRET: read('AUTH_SECRET'),
    SESSION_TTL_HOURS: read('SESSION_TTL_HOURS'),
    ALLOWED_EMAIL_DOMAINS: read('ALLOWED_EMAIL_DOMAINS'),
    ADMIN_EMAILS: read('ADMIN_EMAILS'),
    PUBLIC_SITE_URL: read('PUBLIC_SITE_URL'),
    UPLOADS_DIR: read('UPLOADS_DIR'),
    MAX_UPLOAD_MB: read('MAX_UPLOAD_MB'),
    // Los nombres viejos (DEEPSEEK_*) siguen valiendo de respaldo para que un
    // entorno sin actualizar no se quede sin motor al desplegar.
    AI_ALPHA_API_KEY: read('AI_ALPHA_API_KEY') ?? read('DEEPSEEK_API_KEY'),
    AI_ALPHA_BASE_URL: read('AI_ALPHA_BASE_URL') ?? read('DEEPSEEK_BASE_URL'),
    AI_ALPHA_MODEL: read('AI_ALPHA_MODEL') ?? read('DEEPSEEK_MODEL_FLASH'),
    AI_DEEPSEEK_API_KEY: read('AI_DEEPSEEK_API_KEY') ?? read('DEEPSEEK_API_KEY_OLD_DEEPSEEK'),
    AI_DEEPSEEK_BASE_URL: read('AI_DEEPSEEK_BASE_URL'),
    AI_DEEPSEEK_MODEL: read('AI_DEEPSEEK_MODEL'),
    AI_MINIMAX_API_KEY: read('AI_MINIMAX_API_KEY'),
    AI_MINIMAX_BASE_URL: read('AI_MINIMAX_BASE_URL'),
    AI_MINIMAX_MODEL: read('AI_MINIMAX_MODEL'),
    AI_MINIMAX_FALLBACK_MODEL: read('AI_MINIMAX_FALLBACK_MODEL'),
    AI_ALPHA_MAX_TOKENS: read('AI_ALPHA_MAX_TOKENS') ?? read('AI_MAX_TOKENS'),
    AI_DEEPSEEK_MAX_TOKENS: read('AI_DEEPSEEK_MAX_TOKENS'),
    AI_MINIMAX_MAX_TOKENS: read('AI_MINIMAX_MAX_TOKENS'),
    AI_ALPHA_USER_TOKEN_LIMIT: read('AI_ALPHA_USER_TOKEN_LIMIT'),
    AI_DEEPSEEK_USER_TOKEN_LIMIT: read('AI_DEEPSEEK_USER_TOKEN_LIMIT'),
    AI_MINIMAX_USER_TOKEN_LIMIT: read('AI_MINIMAX_USER_TOKEN_LIMIT'),
    AI_ALPHA_MAX_INPUT_CHARS: read('AI_ALPHA_MAX_INPUT_CHARS'),
    AI_DEEPSEEK_MAX_INPUT_CHARS: read('AI_DEEPSEEK_MAX_INPUT_CHARS'),
    AI_MINIMAX_MAX_INPUT_CHARS: read('AI_MINIMAX_MAX_INPUT_CHARS'),
    AI_VISION: read('AI_VISION'),
    GOOGLE_CLIENT_ID: read('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: read('GOOGLE_CLIENT_SECRET'),
    KODU_ENCRYPTION_KEY: read('KODU_ENCRYPTION_KEY'),
    RESEND_API_KEY: read('RESEND_API_KEY'),
    RESEND_FROM: read('RESEND_FROM'),
    RESEND_API_URL: read('RESEND_API_URL'),
    BILLING_PROVIDER: read('BILLING_PROVIDER'),
    MP_ACCESS_TOKEN: read('MP_ACCESS_TOKEN'),
    MP_WEBHOOK_SECRET: read('MP_WEBHOOK_SECRET'),
    BILLING_FAKE_NOW: read('BILLING_FAKE_NOW'),
    INTERNAL_CRON_SECRET: read('INTERNAL_CRON_SECRET'),
  });

  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion de entorno invalida:\n${detalle}\n\nRevisa tu archivo .env`);
  }

  cached = parsed.data;

  // odd/tasks/organizaciones.md (T3, decisión del dueño — "fallback sin
  // Resend"): una sola vez por arranque del proceso (cached recién se puso),
  // no en cada request. `/admin` repite el mismo aviso en la UI
  // (AdminLayout.astro) para quien no mira los logs del servidor.
  if (!cached.RESEND_API_KEY) {
    console.warn(
      '[env] RESEND_API_KEY no está configurada: toda cuenta nueva se toma como verificada (NO_PROVIDER).',
    );
  }

  return cached;
}

/** Google Sign-In queda activo solo si estan las dos credenciales. */
export function isGoogleEnabled(): boolean {
  const env = getEnv();
  return env.GOOGLE_CLIENT_ID.length > 0 && env.GOOGLE_CLIENT_SECRET.length > 0;
}

/**
 * odd/tasks/organizaciones.md (T2): mientras esto sea `false`, cualquier
 * cuenta nueva se toma como verificada (fallback "sin Resend", decisión del
 * dueño) — ver `src/lib/orgs/membresia.ts#emailConfiable`, la única fuente
 * de verdad de esa regla.
 */
export function hasResendApiKey(): boolean {
  return getEnv().RESEND_API_KEY.length > 0;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/**
 * odd/tasks/planes-y-cobros.md (T4): "ahora" para todo cálculo de cobro que
 * dependa de la fecha (`ciclo.ts#firstCharge` al contratar). Es `new Date()`
 * salvo en un e2e local: `BILLING_FAKE_NOW` sólo se honra con
 * `BILLING_PROVIDER=simulado` y fuera de producción — las dos condiciones
 * juntas, no una sola, para que cargarla por error en un entorno real (o
 * dejarla en un `.env` de producción por descuido) nunca tenga efecto.
 */
export function billingNow(): Date {
  const env = getEnv();
  if (env.BILLING_PROVIDER === 'simulado' && env.NODE_ENV !== 'production' && env.BILLING_FAKE_NOW) {
    const parsed = new Date(env.BILLING_FAKE_NOW);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/** Lista de dominios institucionales habilitados, normalizada. */
export function getAllowedDomains(): string[] {
  return getEnv()
    .ALLOWED_EMAIL_DOMAINS.split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

/** Emails que reciben rol ADMIN de forma automatica al registrarse. */
export function getAdminEmails(): string[] {
  return getEnv()
    .ADMIN_EMAILS.split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}
