import { z } from 'zod';

/** Contratos de entrada de los endpoints de autenticacion. */

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(120, 'El nombre es demasiado largo'),
  email: z.string().trim().toLowerCase().email('Ingresá un email válido'),
  password: z
    .string()
    .min(8, 'La contraseña debe tener al menos 8 caracteres')
    .max(200, 'La contraseña es demasiado larga'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ingresá un email válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Devuelve el primer mensaje de error, que es lo que mostramos en el formulario. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Datos inválidos';
}
