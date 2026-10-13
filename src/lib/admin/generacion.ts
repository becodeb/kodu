import { prisma } from '../db.ts';
import { leerAppSettings } from '../settings.ts';
import { presetByKey } from '../ai/presets.ts';
import {
  MODES,
  MODO_PERSONALIZADO_KEY,
  ORDEN_MODOS,
  modoEfectivo,
  inicioDelCiclo,
  finDelCiclo,
  proyeccionDeCierre,
  gastoDelCicloActual,
} from '../ai/modos-generacion.ts';

export interface ModeloParaSelector {
  id: string;
  displayName: string;
}

export interface ModoUI {
  key: string;
  label: string;
  description: string;
  measuredCreation: string;
  measuredAdjustment: string;
  /** Nombres de preset (legibles) que este modo necesita y que NINGÚN
   *  `AiModel` habilitado tiene enlazado — para el aviso inline + el link a
   *  `/admin/motores`. Vacío = el modo está listo para usarse. */
  presetsFaltantes: string[];
}

export interface CicloActualUI {
  inicioIso: string;
  finIso: string;
  gastoUsd: number;
  /** El modo que REALMENTE corre ahora (puede ser distinto del
   *  configurado, si el gasto ya pasó `premiumUntilUsd`). */
  modoEfectivo: string;
  proyeccionUsd: number;
}

export interface ResumenGeneracion {
  versionsForAll: boolean;
  generationMode: string;
  creationModelId: string | null;
  adjustmentModelId: string | null;
  monthlyCreditUsd: string;
  premiumUntilUsd: string;
  billingCycleDay: number;
  modos: ModoUI[];
  /** Para los dos `<select>` de "personalizado" — sólo motores habilitados
   *  Y con cuenta habilitada (lo mismo que `catalogo.ts#utilizable`). */
  modelosHabilitados: ModeloParaSelector[];
  ciclo: CicloActualUI;
}

/**
 * `/admin/generacion` (T7, motor-claude): valores planos, sin `Prisma.Decimal`
 * ni tipos del cliente generado — mismo criterio que `lib/admin/modelos.ts`,
 * el componente (`GeneracionPanel.tsx`, isla `client:load`) nunca debe
 * importar nada de eso.
 */
export async function resumenGeneracion(): Promise<ResumenGeneracion> {
  const settings = await leerAppSettings();

  const filas = await prisma.aiModel.findMany({
    where: { enabled: true, provider: { enabled: true } },
    select: { id: true, displayName: true, presetKey: true },
    orderBy: { sortOrder: 'asc' },
  });

  const presetKeysHabilitados = new Set(filas.map((fila) => fila.presetKey).filter((key): key is string => key !== null));

  const modos: ModoUI[] = ORDEN_MODOS.filter((key) => key !== MODO_PERSONALIZADO_KEY).map((key) => {
    const modo = MODES[key]!;
    const presetsDelModo = new Set([modo.roles.creation.presetKey, modo.roles.adjustment.presetKey]);
    const presetsFaltantes = [...presetsDelModo]
      .filter((presetKey) => !presetKeysHabilitados.has(presetKey))
      .map((presetKey) => presetByKey(presetKey)?.label ?? presetKey);

    return {
      key: modo.key,
      label: modo.label,
      description: modo.description,
      measuredCreation: modo.measured.creation,
      measuredAdjustment: modo.measured.adjustment,
      presetsFaltantes,
    };
  });

  const ahora = new Date();
  const inicio = inicioDelCiclo(settings.billingCycleDay, ahora);
  const fin = finDelCiclo(settings.billingCycleDay, inicio);
  const gastoUsd = await gastoDelCicloActual(settings.billingCycleDay, ahora);
  const efectivo = modoEfectivo(settings.generationMode, gastoUsd, settings.premiumUntilUsd.toNumber());

  return {
    versionsForAll: settings.versionsForAll,
    generationMode: settings.generationMode,
    creationModelId: settings.creationModelId,
    adjustmentModelId: settings.adjustmentModelId,
    monthlyCreditUsd: settings.monthlyCreditUsd.toString(),
    premiumUntilUsd: settings.premiumUntilUsd.toString(),
    billingCycleDay: settings.billingCycleDay,
    modos,
    modelosHabilitados: filas.map((fila) => ({ id: fila.id, displayName: fila.displayName })),
    ciclo: {
      inicioIso: inicio.toISOString(),
      finIso: fin.toISOString(),
      gastoUsd,
      modoEfectivo: efectivo,
      proyeccionUsd: proyeccionDeCierre(gastoUsd, inicio, fin, ahora),
    },
  };
}
