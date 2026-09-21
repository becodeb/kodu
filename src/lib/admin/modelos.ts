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
  sortOrder: number;
  maxOutputTokens: number;
  maxInputChars: number;
  supportsVision: boolean;
  userTokenLimit: number;
  /** Ventana móvil del tope, en horas. 0 = desde siempre. */
  userTokenWindowHours: number;
  /** "none" | "low" | "high" | "max", o null = no mandar el parámetro. */
  reasoningEffort: string | null;
  /** "reasoning_effort" (default) o "thinking". */
  reasoningParam: string | null;
  fallbackModelId: string | null;
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
    sortOrder: fila.sortOrder,
    maxOutputTokens: fila.maxOutputTokens,
    maxInputChars: fila.maxInputChars,
    supportsVision: fila.supportsVision,
    userTokenLimit: fila.userTokenLimit,
    userTokenWindowHours: fila.userTokenWindowHours,
    reasoningEffort: fila.reasoningEffort,
    reasoningParam: fila.reasoningParam,
    fallbackModelId: fila.fallbackModelId,
  };
}

/** `undefined` = no vino en el body, `null` = precio sin cargar, número = valor nuevo. */
export function precioADecimal(valor: number | null | undefined): Prisma.Decimal | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Prisma.Decimal(valor);
}
