import type { AiProvider } from '../../generated/prisma/client.ts';

/**
 * Lo que ve el panel admin de una cuenta de proveedor: nunca `apiKeyCipher`
 * (design.md de catalogo-de-proveedores §5), sólo si hay una clave cargada y
 * su pista. `motores` viene del `_count` de Prisma y sólo está presente donde
 * se pidió (el listado); en otros contextos queda `undefined`.
 */
export interface ProveedorAdmin {
  id: string;
  kind: string;
  label: string;
  baseUrl: string;
  /** T2 (verificador): "chat" (default) o "responses". */
  apiFormat: string;
  /** Nunca la clave ni el cifrado: sólo si hay una cargada. */
  tieneClave: boolean;
  apiKeyHint: string | null;
  enabled: boolean;
  /** Cuántos motores dependen de esta cuenta. Ausente donde no se pidió el _count. */
  motores?: number;
}

export function serializarProveedor(fila: AiProvider & { _count?: { modelos: number } }): ProveedorAdmin {
  return {
    id: fila.id,
    kind: fila.kind,
    label: fila.label,
    baseUrl: fila.baseUrl,
    apiFormat: fila.apiFormat,
    tieneClave: fila.apiKeyCipher !== null,
    apiKeyHint: fila.apiKeyHint,
    enabled: fila.enabled,
    motores: fila._count?.modelos,
  };
}
