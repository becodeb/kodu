import { Prisma } from '../../generated/prisma/client.ts';
import type { AiModel } from '../../generated/prisma/client.ts';

/**
 * Lo que ve el panel admin de un motor: nunca `apiKeyCipher`, y los tres
 * precios ya convertidos a string (design.md §2 — `Prisma.Decimal` no
 * sobrevive un `JSON.stringify` como número; a un componente de React le
 * llega `{}`). Este es el ÚNICO lugar donde se hace esa conversión, para no
 * repetir el trampolín en cada endpoint.
 */
export interface MotorAdmin {
  id: string;
  provider: string;
  providerModel: string;
  displayName: string;
  description: string | null;
  adminNote: string | null;
  baseUrl: string;
  /** Nunca la clave ni el cifrado: sólo si hay una cargada. */
  tieneClave: boolean;
  apiKeyHint: string | null;
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
  fallbackModelId: string | null;
}

export function serializarMotor(fila: AiModel): MotorAdmin {
  return {
    id: fila.id,
    provider: fila.provider,
    providerModel: fila.providerModel,
    displayName: fila.displayName,
    description: fila.description,
    adminNote: fila.adminNote,
    baseUrl: fila.baseUrl,
    tieneClave: fila.apiKeyCipher !== null,
    apiKeyHint: fila.apiKeyHint,
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
    fallbackModelId: fila.fallbackModelId,
  };
}

/** `undefined` = no vino en el body, `null` = precio sin cargar, número = valor nuevo. */
export function precioADecimal(valor: number | null | undefined): Prisma.Decimal | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  return new Prisma.Decimal(valor);
}
