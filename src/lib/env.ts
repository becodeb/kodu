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
   * Motor de IA. Hay dos proveedores y el docente elige cuál usa.
   *
   * ALPHA es el de todos los días: gratuito, multimodal y sin cupo. DEEPSEEK se
   * paga por token, así que trae tope por usuario — sin ese tope, un docente
   * solo puede vaciar la cuenta en una tarde.
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

  /**
   * Tope de tokens de UNA respuesta. Alto a propósito: el contrato obliga a la
   * IA a devolver el documento HTML completo en cada edición, y si se queda
   * corta el recurso vuelve cortado por la mitad. El tope existe para que una
   * respuesta desbocada no coma la memoria del servidor, no para ahorrar.
   */
  AI_ALPHA_MAX_TOKENS: z.coerce.number().int().positive().default(65_536),
  AI_DEEPSEEK_MAX_TOKENS: z.coerce.number().int().positive().default(8_192),

  /**
   * Tope ACUMULADO por usuario, en tokens. 0 = sin tope.
   * Alpha es gratis, así que no lleva; DeepSeek sí.
   */
  AI_ALPHA_USER_TOKEN_LIMIT: z.coerce.number().int().min(0).default(0),
  AI_DEEPSEEK_USER_TOKEN_LIMIT: z.coerce.number().int().min(0).default(300_000),

  /** Si Alpha recibe las imágenes adjuntas (formato OpenAI `image_url`). */
  AI_VISION: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
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
    AI_ALPHA_MAX_TOKENS: read('AI_ALPHA_MAX_TOKENS') ?? read('AI_MAX_TOKENS'),
    AI_DEEPSEEK_MAX_TOKENS: read('AI_DEEPSEEK_MAX_TOKENS'),
    AI_ALPHA_USER_TOKEN_LIMIT: read('AI_ALPHA_USER_TOKEN_LIMIT'),
    AI_DEEPSEEK_USER_TOKEN_LIMIT: read('AI_DEEPSEEK_USER_TOKEN_LIMIT'),
    AI_VISION: read('AI_VISION'),
  });

  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion de entorno invalida:\n${detalle}\n\nRevisa tu archivo .env`);
  }

  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
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
