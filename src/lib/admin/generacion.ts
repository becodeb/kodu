import { prisma } from '../db.ts';
import { leerAppSettings } from '../settings.ts';
import { presetByKey } from '../ai/presets.ts';
import { motorVerificador } from '../ai/catalogo.ts';
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
  /**
   * Hallazgo de revisión (motor-claude, pre-deploy): si HAY un motor
   * verificador USABLE ahora mismo (`catalogo.ts#motorVerificador` —
   * habilitado, cuenta habilitada, con clave; no sólo "algún `AiModel` con
   * `isVerifier: true` en la base", que podría estar apagado). `false` es
   * lo que dispara el aviso + el botón de abajo en `GeneracionPanel.tsx`.
   */
  hayVerificadorUsable: boolean;
  /**
   * El primer motor HABILITADO (cuenta habilitada también) enlazado al
   * preset de Haiku 5.5, si hay uno — lo que necesita el botón "Usar Haiku
   * 5.5 como revisor". `null` si el admin todavía no cargó ese preset (ahí
   * el aviso señala a `/admin/motores` en vez de ofrecer el botón).
   */
  haikuParaVerificador: ModeloParaSelector | null;
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

  // Hallazgo de revisión (motor-claude, pre-deploy): el aviso + botón "Usar
  // Haiku 5.5 como revisor" de `GeneracionPanel.tsx` necesitan saber (a) si
  // el revisor está EFECTIVAMENTE apagado ahora mismo (no sólo "sin ninguna
  // fila marcada" — `motorVerificador` ya cubre motor/cuenta apagados y
  // clave faltante) y (b) a qué motor apuntar el botón: `filas` arriba ya
  // viene filtrada a habilitado+cuenta habilitada, así que basta buscar el
  // preset de Haiku ahí.
  const verificadorUsable = await motorVerificador();
  const haikuHabilitado = filas.find((fila) => fila.presetKey === 'claude-haiku-5-5') ?? null;

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
    hayVerificadorUsable: verificadorUsable !== null,
    haikuParaVerificador: haikuHabilitado ? { id: haikuHabilitado.id, displayName: haikuHabilitado.displayName } : null,
  };
}
