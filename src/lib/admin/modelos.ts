import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.ts';
import type { AiModel, AiProvider } from '../../generated/prisma/client.ts';
import { serializarProveedor, type ProveedorAdmin } from './proveedores.ts';

/**
 * Lo que ve el panel admin de un motor: nunca `apiKeyCipher`, y los tres
 * precios ya convertidos a string (design.md §2 — `Prisma.Decimal` no
 * sobrevive un `JSON.stringify` como número; a un componente de React le
 * llega `{}`). Este es el ÚNICO lugar donde se hace esa conversión, para no
 * repetir el trampolín en cada endpoint.
 */
export interface MotorAdmin {
  id: string;
  providerId: string;
  /** Era un string. Ahora es la cuenta, ya enmascarada (catalogo-de-proveedores). */
  provider: ProveedorAdmin;
  providerModel: string;
  displayName: string;
  description: string | null;
  adminNote: string | null;
  priceInputPerMToken: string | null;
  priceCachedInputPerMToken: string | null;
  priceOutputPerMToken: string | null;
  enabled: boolean;
  selectableByTeacher: boolean;
  isDefault: boolean;
  /** T3 (verificador): a lo sumo un motor en `true` — ver el índice único
   *  parcial de la migración y `motorVerificador()` en `catalogo.ts`. */
  isVerifier: boolean;
  sortOrder: number;
  maxOutputTokens: number;
  maxInputChars: number;
  supportsVision: boolean;
  userTokenLimit: number;
  /** Ventana móvil del tope, en horas. 0 = desde siempre. */
  userTokenWindowHours: number;
  /** "none" | "low" | "high", o null = no mandar el parámetro. */
  reasoningEffort: string | null;
  /** "reasoning_effort" (default) o "thinking". */
  reasoningParam: string | null;
  fallbackModelId: string | null;
  /** odd/tasks/ahorro-tokens.md (T1): `null` = sin horario de pico, precio
   *  de pico siempre (comportamiento de siempre). */
  priceOffPeakFactor: string | null;
  /** `[{weekday, startHour, endHour}]` en UTC. `[]` si no hay ninguna. */
  peakWindowsUtc: Array<{ weekday: number; startHour: number; endHour: number }>;
  /** Fechas "YYYY-MM-DD" (UTC) tratadas como fuera de pico sin importar la hora. */
  offPeakDatesUtc: string[];
}

export function serializarMotor(fila: AiModel & { provider: AiProvider }): MotorAdmin {
  return {
    id: fila.id,
    providerId: fila.providerId,
    provider: serializarProveedor(fila.provider),
    providerModel: fila.providerModel,
    displayName: fila.displayName,
    description: fila.description,
    adminNote: fila.adminNote,
    priceInputPerMToken: fila.priceInputPerMToken?.toString() ?? null,
    priceCachedInputPerMToken: fila.priceCachedInputPerMToken?.toString() ?? null,
    priceOutputPerMToken: fila.priceOutputPerMToken?.toString() ?? null,
    enabled: fila.enabled,
    selectableByTeacher: fila.selectableByTeacher,
    isDefault: fila.isDefault,
    isVerifier: fila.isVerifier,
    sortOrder: fila.sortOrder,
    maxOutputTokens: fila.maxOutputTokens,
    maxInputChars: fila.maxInputChars,
    supportsVision: fila.supportsVision,
    userTokenLimit: fila.userTokenLimit,
    userTokenWindowHours: fila.userTokenWindowHours,
    reasoningEffort: fila.reasoningEffort,
    reasoningParam: fila.reasoningParam,
    fallbackModelId: fila.fallbackModelId,
    priceOffPeakFactor: fila.priceOffPeakFactor?.toString() ?? null,
    peakWindowsUtc: Array.isArray(fila.peakWindowsUtc)
      ? (fila.peakWindowsUtc as unknown as Array<{ weekday: number; startHour: number; endHour: number }>)
      : [],
    offPeakDatesUtc: Array.isArray(fila.offPeakDatesUtc) ? (fila.offPeakDatesUtc as unknown as string[]) : [],
  };
}

/** `undefined` = no vino en el body, `null` = precio sin cargar, número = valor nuevo. */
export function precioADecimal(valor: number | null | undefined): Prisma.Decimal | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Prisma.Decimal(valor);
}

/**
 * odd/tasks/ahorro-tokens.md (T1): el schema zod de los tres campos del
 * horario de pico, compartido entre POST (alta) y PATCH (edición) de un
 * motor — así los dos endpoints validan exactamente lo mismo.
 * `priceOffPeakFactor: null` apaga el horario entero (comportamiento de
 * siempre): no tiene sentido guardar ventanas/feriados sin un factor.
 */
export const horarioDePicoSchema = {
  priceOffPeakFactor: z
    .union([z.coerce.number().min(0, 'El factor no puede ser negativo').max(1, 'El factor es a lo sumo 1 (nunca más caro fuera de pico)'), z.null()])
    .optional(),
  peakWindowsUtc: z
    .array(
      z.object({
        weekday: z.coerce.number().int().min(0).max(6),
        startHour: z.coerce.number().int().min(0).max(23),
        endHour: z.coerce.number().int().min(0).max(24),
      }),
    )
    .max(50)
    .optional(),
  offPeakDatesUtc: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida (YYYY-MM-DD)')).max(500).optional(),
};

/** Convierte lo validado del horario de pico a lo que Prisma espera para
 *  `Json?` (`Prisma.JsonNull` para "sin horario", nunca `undefined`). */
export function horarioDePicoAPrisma(datos: {
  priceOffPeakFactor?: number | null;
  peakWindowsUtc?: Array<{ weekday: number; startHour: number; endHour: number }>;
  offPeakDatesUtc?: string[];
}): {
  priceOffPeakFactor?: Prisma.Decimal | null;
  peakWindowsUtc?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  offPeakDatesUtc?: Prisma.InputJsonValue | typeof Prisma.JsonNull;
} {
  const cambios: ReturnType<typeof horarioDePicoAPrisma> = {};

  if (datos.priceOffPeakFactor !== undefined) {
    cambios.priceOffPeakFactor = datos.priceOffPeakFactor === null ? null : new Prisma.Decimal(datos.priceOffPeakFactor);
    // Apagar el horario entero: no dejar ventanas/feriados colgados sin factor.
    if (datos.priceOffPeakFactor === null) {
      cambios.peakWindowsUtc = Prisma.JsonNull;
      cambios.offPeakDatesUtc = Prisma.JsonNull;
    }
  }
  if (datos.peakWindowsUtc !== undefined) cambios.peakWindowsUtc = datos.peakWindowsUtc;
  if (datos.offPeakDatesUtc !== undefined) cambios.offPeakDatesUtc = datos.offPeakDatesUtc;

  return cambios;
}
