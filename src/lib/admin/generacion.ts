import { prisma } from '../db.ts';
import { leerAppSettings } from '../settings.ts';
import { presetByKey } from '../ai/presets.ts';
import { motorVerificador } from '../ai/catalogo.ts';
import {
  MODES,
  MODO_PERSONALIZADO_KEY,
  MODO_AUTOMATICO_KEY,
  ORDEN_MODOS,
  modoEfectivo,
  inicioDelCiclo,
  finDelCiclo,
  proyeccionDeCierre,
  gastoDelCicloActual,
  tierAutomaticoActual,
  type TierAutomatico,
} from '../ai/modos-generacion.ts';

const ETIQUETA_POR_TIER: Record<TierAutomatico, string> = {
  haiku: 'Haiku',
  sonnet: 'Sonnet',
  opus: 'Opus',
};

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
  /**
   * T14: sólo presente cuando el modo efectivo es `automatico` — la línea
   * viva "Hoy los recursos nuevos usan: X — porque …" del panel. `null` en
   * cualquier otro modo (nunca se calcula el pacing si no corresponde).
   */
  automatico: {
    tierEtiqueta: string;
    razon: string;
    diasRestantes: number;
    creditoRestanteUsd: number;
    proyeccionCierreUsd: number;
  } | null;
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
  /**
   * T16 (motor-claude, "automatico" en producción): si HAY alguna cuenta
   * `AiProvider` `apiFormat: "anthropic"` HABILITADA — sin esto, ni el modo
   * `automatico` ni la auto-provisión (`catalogo.ts#asegurarMotorDePresetSiFalta`)
   * tienen de dónde sacar un motor Claude, sin importar qué modo esté
   * configurado. `false` dispara el aviso "Cargá la clave de Anthropic…".
   */
  hayCuentaAnthropicHabilitada: boolean;
  /**
   * Los motores Claude (Haiku/Sonnet/Opus 5.5) ya habilitados ahora mismo —
   * los haya cargado el admin a mano o los haya creado la auto-provisión
   * del punto 1 de arriba. El panel los lista para que quede claro qué
   * quedó configurado solo, sin que el admin tenga que ir a revisar
   * `/admin/motores`.
   */
  modelosClaudeHabilitados: Array<ModeloParaSelector & { presetKey: string }>;
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

  // T14: "automatico" vive AFUERA de MODES (sus roles no son fijos) — se
  // describe a mano, y nunca tiene "presetsFaltantes" (necesita Haiku Y
  // Sonnet Y Opus según el día, no un preset único que avisar).
  const presetsHaikuYSonnet = ['claude-haiku-5-5', 'claude-sonnet-5-5'].filter(
    (presetKey) => !presetKeysHabilitados.has(presetKey),
  );
  const modoAutomaticoUI: ModoUI = {
    key: MODO_AUTOMATICO_KEY,
    label: 'Automático (recomendado)',
    description:
      'El sistema decide sólo, recurso por recurso: Sonnet por defecto, Haiku si el crédito del ciclo viene corto, y Opus en los últimos días si sobra crédito. Cada recurso se ajusta siempre con el motor que lo creó.',
    measuredCreation: 'Varía según el día — ver la caja del ciclo abajo',
    measuredAdjustment: 'El mismo motor con el que nació el recurso',
    presetsFaltantes: presetsHaikuYSonnet.map((presetKey) => presetByKey(presetKey)?.label ?? presetKey),
  };

  const modos: ModoUI[] = [
    modoAutomaticoUI,
    ...ORDEN_MODOS.filter((key) => key !== MODO_PERSONALIZADO_KEY && key !== MODO_AUTOMATICO_KEY).map((key) => {
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
    }),
  ];

  const ahora = new Date();
  const inicio = inicioDelCiclo(settings.billingCycleDay, ahora);
  const fin = finDelCiclo(settings.billingCycleDay, inicio);
  const gastoUsd = await gastoDelCicloActual(settings.billingCycleDay, ahora);
  const efectivo = modoEfectivo(settings.generationMode, gastoUsd, settings.premiumUntilUsd.toNumber());

  // T14: el pacing sólo se calcula cuando el modo EFECTIVO es "automatico"
  // — ningún otro modo paga esta consulta extra en cada carga del panel.
  const decisionAutomatico =
    efectivo === MODO_AUTOMATICO_KEY
      ? await tierAutomaticoActual(
          { billingCycleDay: settings.billingCycleDay, monthlyCreditUsd: settings.monthlyCreditUsd.toNumber(), premiumUntilUsd: settings.premiumUntilUsd.toNumber() },
          ahora,
        )
      : null;

  // Hallazgo de revisión (motor-claude, pre-deploy): el aviso + botón "Usar
  // Haiku 5.5 como revisor" de `GeneracionPanel.tsx` necesitan saber (a) si
  // el revisor está EFECTIVAMENTE apagado ahora mismo (no sólo "sin ninguna
  // fila marcada" — `motorVerificador` ya cubre motor/cuenta apagados y
  // clave faltante) y (b) a qué motor apuntar el botón: `filas` arriba ya
  // viene filtrada a habilitado+cuenta habilitada, así que basta buscar el
  // preset de Haiku ahí.
  const verificadorUsable = await motorVerificador();
  const haikuHabilitado = filas.find((fila) => fila.presetKey === 'claude-haiku-5-5') ?? null;

  // T16: cuenta Anthropic habilitada — independiente de si ya hay algún
  // motor Claude habilitado o no (una cuenta recién cargada, sin ningún
  // motor todavía, también cuenta como "configurado": la auto-provisión del
  // próximo turno real en modo automatico se encarga del resto).
  const hayCuentaAnthropicHabilitada =
    (await prisma.aiProvider.count({ where: { apiFormat: 'anthropic', enabled: true } })) > 0;
  const CLAVES_CLAUDE = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'];
  const modelosClaudeHabilitados = filas
    .filter((fila): fila is typeof fila & { presetKey: string } => fila.presetKey !== null && CLAVES_CLAUDE.includes(fila.presetKey))
    .map((fila) => ({ id: fila.id, displayName: fila.displayName, presetKey: fila.presetKey }));

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
      automatico: decisionAutomatico
        ? {
            tierEtiqueta: ETIQUETA_POR_TIER[decisionAutomatico.tier],
            razon: decisionAutomatico.razon,
            diasRestantes: decisionAutomatico.diasRestantes,
            creditoRestanteUsd: decisionAutomatico.creditoRestanteUsd,
            proyeccionCierreUsd: decisionAutomatico.proyeccionCierreUsd,
          }
        : null,
    },
    hayVerificadorUsable: verificadorUsable !== null,
    haikuParaVerificador: haikuHabilitado ? { id: haikuHabilitado.id, displayName: haikuHabilitado.displayName } : null,
    hayCuentaAnthropicHabilitada,
    modelosClaudeHabilitados,
  };
}
