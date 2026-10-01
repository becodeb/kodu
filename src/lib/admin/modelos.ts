import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.ts';
import type { AiModel, AiProvider } from '../../generated/prisma/client.ts';
import { serializarProveedor, type ProveedorAdmin } from './proveedores.ts';
import { presetByKey, PRESETS } from '../ai/presets.ts';

/**
 * odd/tasks/ahorro-tokens.md (T7): la lista de presets, en forma plana
 * (sin `Prisma.Decimal`) para pasarle a `ModeloForm.tsx` como prop desde
 * `/admin/motores.astro`. El componente (una isla `client:load`) NUNCA debe
 * importar `presets.ts` directo — ese módulo trae `Prisma` del cliente
 * generado, que no tiene por qué ir al bundle del navegador.
 */
export interface PresetUI {
  key: string;
  label: string;
  provider: { baseUrl: string; apiFormat: 'chat' | 'responses' };
  providerModel: string;
  prices: { inputPerMToken: number; cachedInputPerMToken: number; outputPerMToken: number };
  reasoningDefaultEffort: string;
  reasoningParam: string;
  maxOutputTokens: number;
  hasSchedule: boolean;
  pricesVerifiedAt: string;
  sourceUrl: string;
}

export function presetsParaUI(): PresetUI[] {
  return Object.values(PRESETS).map((preset) => ({
    key: preset.key,
    label: preset.label,
    provider: preset.provider,
    providerModel: preset.providerModel,
    prices: preset.prices,
    reasoningDefaultEffort: preset.reasoning.defaultEffort,
    reasoningParam: preset.reasoning.param ?? 'reasoning_effort',
    maxOutputTokens: preset.maxOutputTokens,
    hasSchedule: preset.schedule !== null,
    pricesVerifiedAt: preset.pricesVerifiedAt,
    sourceUrl: preset.sourceUrl,
  }));
}

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
  /** odd/tasks/ahorro-tokens.md (T7): `null` = "Personalizado" (las columnas
   *  de arriba mandan, como siempre). Un valor conocido hace que el precio,
   *  el horario y los feriados de arriba sean sólo un ESPEJO de lo que ya
   *  tiene cargado el preset — en tiempo de ejecución, `catalogo.ts` los
   *  vuelve a leer del preset, nunca de estas columnas. */
  presetKey: string | null;
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
    presetKey: fila.presetKey,
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

/**
 * odd/tasks/ahorro-tokens.md (T7): cuando el admin elige un preset conocido
 * (en vez de "Personalizado"), estos campos vienen DEL PRESET, nunca de lo
 * que haya tipeado el cliente — así la base queda consistente con lo que
 * `catalogo.ts#construirConfig` va a leer en tiempo de ejecución (que ignora
 * estas columnas y usa el preset directo, pero las deja escritas para que el
 * panel pueda mostrarlas sin tener que importar `presets.ts` en el cliente).
 * `presetKey` desconocida o `null` ("Personalizado") devuelve `null`: el
 * resto del body (precio, horario, reasoning, maxOutputTokens tipeados a
 * mano) manda, como siempre.
 */
export function camposDePreset(presetKey: string | null | undefined): Partial<Prisma.AiModelUncheckedCreateInput> | null {
  const preset = presetByKey(presetKey);
  if (!preset) return null;

  return {
    presetKey: preset.key,
    providerModel: preset.providerModel,
    maxOutputTokens: preset.maxOutputTokens,
    reasoningEffort: preset.reasoning.defaultEffort,
    reasoningParam: preset.reasoning.param,
    priceInputPerMToken: new Prisma.Decimal(preset.prices.inputPerMToken),
    priceCachedInputPerMToken: new Prisma.Decimal(preset.prices.cachedInputPerMToken),
    priceOutputPerMToken: new Prisma.Decimal(preset.prices.outputPerMToken),
    priceOffPeakFactor: preset.schedule ? preset.schedule.offPeakFactor : null,
    peakWindowsUtc: preset.schedule ? (preset.schedule.peakWindows as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    offPeakDatesUtc: preset.schedule ? (preset.schedule.offPeakDates as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
  };
}

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
