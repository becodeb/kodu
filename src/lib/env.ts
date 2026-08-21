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

  // Motor de IA. La API key no es obligatoria para arrancar (la plataforma
  // sirve la galería y el editor igual): se valida al invocar el chat.
  DEEPSEEK_API_KEY: z.string().default(''),
  DEEPSEEK_BASE_URL: z.string().min(1).default('https://api.deepseek.com'),
  DEEPSEEK_MODEL_FLASH: z.string().min(1).default('deepseek-v4-flash'),
  DEEPSEEK_MODEL_PRO: z.string().min(1).default('deepseek-v4-pro'),
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
    DEEPSEEK_API_KEY: read('DEEPSEEK_API_KEY'),
    DEEPSEEK_BASE_URL: read('DEEPSEEK_BASE_URL'),
    DEEPSEEK_MODEL_FLASH: read('DEEPSEEK_MODEL_FLASH'),
    DEEPSEEK_MODEL_PRO: read('DEEPSEEK_MODEL_PRO'),
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
