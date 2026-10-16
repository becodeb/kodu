import { prisma } from '../db.ts';
import type { AiModel, AiProvider } from '../../generated/prisma/client.ts';
import { ClaveInvalida, ClaveNoConfigurada, descifrar } from '../crypto/secretos.ts';
import type { ProviderConfig } from './provider.ts';
import type { MotorPublico } from '../workspace-types.ts';
import { scheduleFromAiModel } from './pricing.ts';
import { presetByKey, preciosDePreset } from './presets.ts';
import {
  MODES,
  MODO_PERSONALIZADO_KEY,
  MODO_AUTOMATICO_KEY,
  HAIKU_LOW,
  modeByKey,
  tierAutomaticoActual,
  type RoleSpec,
  type TierAutomatico,
} from './modos-generacion.ts';

/** Una fila de `AiModel` con su cuenta de proveedor ya incluida. */
export type FilaConProveedor = AiModel & { provider: AiProvider };

/**
 * El catálogo de motores, leído desde `AiModel` (design.md §5).
 *
 * Reemplaza al viejo `resolveProvider`/`MODEL_CHOICES` de `provider.ts`: ahí
 * el motor era un valor fijo del enum, acá es una fila que un admin puede
 * prender, apagar, reordenar o cambiar de clave sin tocar código.
 */

/**
 * 30 segundos: un admin que apaga un motor lo ve reflejado en el selector del
 * docente en la próxima carga de página, sin servir nunca una clave vieja
 * (la invalidación explícita en cada mutación del panel hace que el TTL sea
 * sólo una red para un futuro deploy multi-proceso — hoy Astro node standalone
 * es un solo proceso, así que la invalidación explícita ya es exacta).
 */
const CACHE_TTL_MS = 30_000;

/**
 * Tope DURO de la cadena de respaldo, constante de código y no un ajuste del
 * panel: cada eslabón puede tardar hasta ~102s en agotar sus reintentos
 * (`provider.ts`), así que una cadena de 5 sería ocho minutos de espera antes
 * de decirle al docente que nada funcionó.
 */
const TOPE_CADENA = 3;

let cache: { filas: FilaConProveedor[]; expira: number } | null = null;

async function filasDelCatalogo(): Promise<FilaConProveedor[]> {
  if (cache && cache.expira > Date.now()) return cache.filas;

  const filas = await prisma.aiModel.findMany({ orderBy: { sortOrder: 'asc' }, include: { provider: true } });
  cache = { filas, expira: Date.now() + CACHE_TTL_MS };
  return filas;
}

/** Se llama desde cada mutación de `/api/admin/models/*` Y `/api/admin/providers/*` (M3, catalogo-de-proveedores). */
export function invalidarCatalogo(): void {
  cache = null;
}

/** Un motor sirve sólo si están prendidos los dos: el motor y su cuenta. */
function utilizable(fila: FilaConProveedor): boolean {
  return fila.enabled && fila.provider.enabled;
}

/**
 * Descifra la clave de la cuenta de una fila. `null` si no tiene clave
 * cargada o si no se pudo descifrar — en los dos casos el motor se trata
 * como sin clave, nunca se tira una excepción hacia arriba: un admin
 * cambiando `KODU_ENCRYPTION_KEY` a mitad de despliegue no tiene por qué
 * tirar abajo el chat de todos.
 */
function clavePlano(fila: FilaConProveedor): string | null {
  if (!fila.provider.apiKeyCipher) return null;

  try {
    return descifrar(fila.provider.apiKeyCipher, fila.provider.id);
  } catch (error) {
    if (error instanceof ClaveNoConfigurada || error instanceof ClaveInvalida) {
      // Nunca se loguea el ciphertext ni la clave: sólo el id del motor Y el
      // de la cuenta — con una cuenta alimentando varios motores, el id de
      // la cuenta es lo que hace la línea accionable.
      console.error(
        `[catalogo] motor ${fila.id} (${fila.displayName}) de la cuenta ${fila.provider.id} sin clave utilizable: ${error.name}`,
      );
      return null;
    }
    throw error;
  }
}

function construirConfig(fila: FilaConProveedor): ProviderConfig {
  // odd/tasks/ahorro-tokens.md (T7): un `presetKey` conocido manda sobre las
  // columnas de precio/horario de ESTA fila — así un cambio de precio en
  // `presets.ts` actualiza todo motor enlazado sin tocar la base. Una clave
  // desconocida (preset sacado del código después de enlazarse) cae al mismo
  // camino que `presetKey: null`: las columnas de la fila, nunca un crash.
  const preset = presetByKey(fila.presetKey);

  // T9 (motor-claude): `preciosDePreset` ya trae `cacheWrite` cuando el
  // preset lo define (los tres de Anthropic) — antes de T9 esta rama nunca
  // pasaba `cacheWrite`, así que un motor Anthropic enlazado a un preset
  // facturaba su escritura de cache al 1.25x genérico de `calcularCostoTurno`
  // en vez del precio real del proveedor.
  const precios = preset
    ? preciosDePreset(preset)
    : fila.priceInputPerMToken !== null && fila.priceOutputPerMToken !== null
      ? {
          input: fila.priceInputPerMToken,
          output: fila.priceOutputPerMToken,
          cachedInput: fila.priceCachedInputPerMToken,
          // T1 (motor-claude): sin tarifa propia cargada, `calcularCostoTurno`
          // ya cae al 1.25x del precio de entrada — acá sólo se pasa la
          // columna, nunca se inventa el default (eso vive en usage.ts).
          cacheWrite: fila.priceCacheWritePerMToken,
        }
      : null;

  return {
    id: fila.id,
    label: fila.displayName,
    // Cadena vacía cuando no hay clave utilizable: es el mismo camino que ya
    // recorría un motor sin `AI_*_API_KEY` cargada (`requestCompletionStream`
    // lo rechaza con 503 antes de pegarle a la red).
    apiKey: clavePlano(fila) ?? '',
    baseUrl: fila.provider.baseUrl,
    // T2/T1 (verificador / motor-claude): "responses" y "anthropic" son los
    // dos valores reconocidos aparte de "chat" — cualquier otra cosa se
    // trata como "chat", mismo criterio defensivo que el resto de este
    // archivo (nunca un throw por un dato de fila inesperado, ver
    // `clavePlano` más arriba).
    apiFormat:
      fila.provider.apiFormat === 'responses'
        ? 'responses'
        : fila.provider.apiFormat === 'anthropic'
          ? 'anthropic'
          : 'chat',
    model: fila.providerModel,
    maxTokens: fila.maxOutputTokens,
    userTokenLimit: fila.userTokenLimit,
    userTokenWindowHours: fila.userTokenWindowHours,
    maxInputChars: fila.maxInputChars,
    supportsVision: fila.supportsVision,
    reasoningEffort: fila.reasoningEffort,
    reasoningParam: fila.reasoningParam,
    precios,
    schedule: preset ? preset.schedule : scheduleFromAiModel(fila),
  };
}

function tieneClaveUtilizable(config: ProviderConfig): boolean {
  return config.apiKey.length > 0;
}

/** Resuelve un `id` puntual del catálogo. `null` si la fila no existe. */
export async function resolverMotor(modelId: string | null): Promise<ProviderConfig | null> {
  if (!modelId) return null;

  const filas = await filasDelCatalogo();
  const fila = filas.find((candidata) => candidata.id === modelId);
  return fila ? construirConfig(fila) : null;
}

/**
 * El motor con el que arranca la plataforma cuando no hay uno elegido.
 *
 * El índice único parcial de `isDefault` permite CERO filas en true (nunca
 * más de una, pero puede no haber ninguna), así que este resolver tiene que
 * poder arreglárselas sin default: cae al habilitado de menor `sortOrder`.
 */
export async function motorPorDefecto(): Promise<ProviderConfig | null> {
  const filas = await filasDelCatalogo();

  const porDefecto = filas.find((fila) => fila.isDefault && utilizable(fila));
  if (porDefecto) return construirConfig(porDefecto);

  const [habilitado] = filas.filter((fila) => utilizable(fila)).sort((a, b) => a.sortOrder - b.sortOrder);
  if (!habilitado) {
    console.error('[catalogo] no hay ningún motor habilitado — el chat va a contestar 503');
    return null;
  }

  console.warn(
    `[catalogo] sin default activo; se usa "${habilitado.displayName}" por ser el habilitado con menor sortOrder`,
  );
  return construirConfig(habilitado);
}

/**
 * El motor que corresponde usar para un pedido: el `id` pedido si existe y
 * está habilitado, o el default en cualquier otro caso (falta, no existe,
 * está apagado). No decide nada sobre reencaminar el proyecto ni sobre
 * avisarle al docente — eso lo hace quien la llama
 * (`src/pages/app/project/[id].astro`: persiste el repunteo y arma el aviso
 * quieto de una sola vez, ver `specs/ai-model-catalog/spec.md`).
 */
export async function normalizarMotor(modelId: string | null): Promise<ProviderConfig | null> {
  const filas = await filasDelCatalogo();
  const fila = modelId ? filas.find((candidata) => candidata.id === modelId) : undefined;

  if (fila && utilizable(fila)) return construirConfig(fila);

  return motorPorDefecto();
}

/**
 * T3 (verificador, odd/tasks/verificador.md): el motor marcado
 * `isVerifier: true`, si está USABLE (motor y cuenta prendidos, con clave
 * cargada) — `null` en cualquier otro caso: sin ningún motor marcado, motor
 * o cuenta apagados, o sin clave utilizable. Ese `null` es exactamente "el
 * verificador está apagado" para `POST /api/chat/verificar`.
 */
export async function motorVerificador(): Promise<ProviderConfig | null> {
  const filas = await filasDelCatalogo();
  const fila = filas.find((candidata) => candidata.isVerifier);
  if (!fila || !fila.enabled || !fila.provider.enabled) return null;

  const config = construirConfig(fila);
  return tieneClaveUtilizable(config) ? config : null;
}

/**
 * La cadena de respaldo a partir de un motor, en el orden que marca
 * `fallbackModelId`, hasta que uno conteste. Se detiene en:
 *  - un ciclo (A→B→A): `visitados` corta ahí, no cuelga el pedido;
 *  - `TOPE_CADENA` eslabones, aunque la cadena siguiera;
 *  - una fila sin `fallbackModelId`.
 *
 * Los motores apagados o sin clave utilizable no entran a la cadena (no vale
 * la pena gastar un intento contra algo que no puede contestar), pero SÍ se
 * atraviesan para seguir al siguiente eslabón. Si la cadena queda vacía, se
 * usa el default como último recurso — aunque tampoco tenga clave: es mejor
 * que `requestCompletionStream` explique "sin clave" a que no haya ningún
 * motor para intentar.
 */
export async function cadenaDeMotores(desdeId: string | null): Promise<ProviderConfig[]> {
  const filas = await filasDelCatalogo();
  const porId = new Map(filas.map((fila) => [fila.id, fila]));

  let actualId = desdeId ?? (await motorPorDefecto())?.id ?? null;
  const cadena: ProviderConfig[] = [];
  const visitados = new Set<string>();

  while (actualId && cadena.length < TOPE_CADENA && !visitados.has(actualId)) {
    visitados.add(actualId);
    const fila = porId.get(actualId);
    if (!fila) break;

    if (utilizable(fila)) {
      const config = construirConfig(fila);
      if (tieneClaveUtilizable(config)) cadena.push(config);
    }

    actualId = fila.fallbackModelId;
  }

  if (cadena.length === 0) {
    const porDefecto = await motorPorDefecto();
    if (porDefecto) cadena.push(porDefecto);
  }

  return cadena;
}

/**
 * Lo que puede elegir un docente: habilitados Y `selectableByTeacher`, sin
 * `provider`/`providerModel` (identificadores internos), sin claves ni
 * precios. Ya en el orden configurado (`filasDelCatalogo` ordena por
 * `sortOrder`).
 */
export async function motoresParaDocente(): Promise<MotorPublico[]> {
  const filas = await filasDelCatalogo();

  return filas
    .filter((fila) => utilizable(fila) && fila.selectableByTeacher)
    .map((fila) => ({
      id: fila.id,
      displayName: fila.displayName,
      description: fila.description,
      supportsVision: fila.supportsVision,
    }));
}

/**
 * T7 (motor-claude): el motor enlazado a `presetKey` que juega este rol,
 * con el esfuerzo que pide el MODO (no el `reasoningEffort` default que
 * quedó guardado al enlazar la fila al preset — un modo puede pedir un
 * esfuerzo distinto del default, ej. Sonnet "low" de revisor en
 * `revisor-sonnet` vs. "medium" de creador en `crea-sonnet`). `null` si no
 * hay ningún motor habilitado con ese preset, o si no tiene clave
 * utilizable — nunca inventa uno.
 */
function motorPorPresetKey(filas: FilaConProveedor[], spec: RoleSpec): ProviderConfig | null {
  const fila = filas.find((candidata) => candidata.presetKey === spec.presetKey && utilizable(candidata));
  if (!fila) return null;

  const config = construirConfig(fila);
  if (!tieneClaveUtilizable(config)) return null;

  return { ...config, reasoningEffort: spec.effort };
}

/** Una combinación modo+rol se loguea UNA SOLA VEZ por proceso — un modo mal
 *  configurado no tiene por qué llenar el log turno a turno. */
const modosDeRespaldoLogueados = new Set<string>();

/**
 * El corazón de la resolución modo→rol, SIN el respaldo final al motor por
 * defecto global — eso lo decide cada llamador (`motorParaRol` y
 * `motorDeGeneracion`, los dos más abajo), porque el respaldo correcto no
 * es el mismo en los dos casos: en aislamiento (sin un proyecto concreto a
 * mano) el default global es lo único que queda; CON un proyecto, lo que
 * corresponde primero es el motor que ESE proyecto ya tenía ANTES de que
 * este modo existiera (`normalizarMotor(project.aiModelId)`) — así un
 * proyecto que no tiene nada que ver con los presets de Claude (p. ej. un
 * motor de prueba sin `presetKey`, de antes de T7) sigue funcionando
 * exactamente igual que siempre mientras el modo activo no tenga su motor
 * configurado, en vez de converger de golpe en el default global de toda
 * la instalación.
 *
 *  1. `'personalizado'`: el motor elegido a mano por el admin para ese rol
 *     (`opts.creationModelId`/`adjustmentModelId`). Sin elegir, apagado o
 *     sin clave → cae al modo `'base'` (paso 2), nunca a un error.
 *  2. Un modo conocido (o `'base'` si la clave no existe más): el motor
 *     enlazado al preset de ese rol, con el esfuerzo del modo.
 *  3. Si el paso 2 no encontró nada Y el modo pedido no era ya `'base'`:
 *     se reintenta con el preset/esfuerzo del rol en `'base'` (se loguea
 *     una vez la primera vez que pasa esto para esa combinación modo+rol).
 *  4. `null` si ni el modo pedido ni `'base'` tienen un motor habilitado
 *     con ese preset — el llamador decide el respaldo final.
 *
 * `filasOverride` (unidad-modos-generacion.ts): el catálogo es
 * INSTANCIA-WIDE a propósito (ver el comentario de `motorPorPresetKey`) —
 * cualquier motor real habilitado en OTRA cuenta/experimento, con el mismo
 * `presetKey` que pide un modo, entra en el mismo `.find()` que un motor de
 * prueba. Eso hace que una prueba que afirma "ningún motor de Opus
 * habilitado" deje de ser verdad en cuanto una ronda real (`crea-opus`,
 * `todo-opus`) deja un motor Opus habilitado en la base de dev — no es un
 * dato que la prueba deba (ni pueda, sin apagar una fila real que no creó)
 * controlar. Este parámetro opcional, nunca usado por los llamadores reales
 * (`stream.ts`/`autocorreccion.ts` jamás lo pasan), deja a una prueba fijar
 * el catálogo entero en memoria para probar la función pura sin depender
 * del estado de la base compartida.
 */
async function resolverRolDeModo(
  modeKey: string,
  role: 'creation' | 'adjustment',
  opts: { creationModelId: string | null; adjustmentModelId: string | null },
  filasOverride?: FilaConProveedor[],
): Promise<ProviderConfig | null> {
  const filas = filasOverride ?? (await filasDelCatalogo());

  if (modeKey === MODO_PERSONALIZADO_KEY) {
    const elegidoId = role === 'creation' ? opts.creationModelId : opts.adjustmentModelId;
    const fila = elegidoId ? filas.find((candidata) => candidata.id === elegidoId && utilizable(candidata)) : undefined;
    if (fila) {
      const config = construirConfig(fila);
      if (tieneClaveUtilizable(config)) return config;
    }
    return resolverRolDeModo('base', role, opts, filasOverride);
  }

  const modo = modeByKey(modeKey) ?? MODES.base!;
  const spec = modo.roles[role];
  const directo = motorPorPresetKey(filas, spec);
  if (directo) return directo;

  if (modo.key !== 'base') {
    const clave = `${modo.key}:${role}`;
    if (!modosDeRespaldoLogueados.has(clave)) {
      modosDeRespaldoLogueados.add(clave);
      console.warn(
        `[catalogo] modo "${modo.key}" sin motor habilitado para el rol "${role}" (preset "${spec.presetKey}") — se usa el modo base en su lugar`,
      );
    }
    const baseDirecto = motorPorPresetKey(filas, MODES.base!.roles[role]);
    if (baseDirecto) return baseDirecto;
  }

  return null;
}

/**
 * T7 (motor-claude): `resolverRolDeModo` EN AISLAMIENTO, para quien no tiene
 * un proyecto concreto a mano (pruebas, un futuro llamador sin contexto de
 * proyecto) — el respaldo final es el motor por defecto de toda la
 * instalación, igual que `normalizarMotor`/`cadenaDeMotores`. Nunca `null`
 * si hay AL MENOS un motor habilitado en el catálogo. El camino real de un
 * turno (`motorDeGeneracion`, abajo) usa `resolverRolDeModo` directo, con
 * un respaldo distinto — ver su comentario.
 */
export async function motorParaRol(
  modeKey: string,
  role: 'creation' | 'adjustment',
  opts: { creationModelId: string | null; adjustmentModelId: string | null },
  filasOverride?: FilaConProveedor[],
): Promise<ProviderConfig | null> {
  const resuelto = await resolverRolDeModo(modeKey, role, opts, filasOverride);
  return resuelto ?? motorPorDefecto();
}

/**
 * El motor con el que corre ESTE turno.
 *
 * Si el proyecto tiene un motor elegido EXPLÍCITAMENTE por el docente
 * (`Project.engineChosenByTeacher`, T7 — nunca la asignación silenciosa
 * inicial ni el swap automático de respaldo), se lo respeta tal cual,
 * igual que siempre (`normalizarMotor(modelIdExplicito ?? project.aiModelId)`).
 *
 * En cualquier otro caso, el modo de generación activo decide según si el
 * turno es de creación o de ajuste — PERO si ni el modo pedido ni `'base'`
 * tienen un motor habilitado para ese rol (`resolverRolDeModo` devuelve
 * `null`: típicamente, el admin todavía no cargó el preset de Claude), el
 * respaldo es el motor que este proyecto YA tenía (`project.aiModelId`),
 * no el default global de toda la instalación — un proyecto ajeno al modo
 * de generación (de antes de T7, o de otra parte de la app que asigna su
 * propio motor directo) sigue funcionando exactamente igual que siempre
 * mientras el modo activo no tenga su motor configurado, en vez de
 * converger de golpe en lo que sea el default de turno.
 */
/** Hallazgo de revisión (motor-claude, pre-deploy): "premium" = Sonnet u
 *  Opus, por el nombre REAL del modelo en el proveedor
 *  (`ProviderConfig.model`) — mismo criterio que ya usa `provider.ts` para
 *  distinguir Haiku (`provider.model.includes('haiku')`), nunca por
 *  `presetKey`: un motor "Personalizado" (sin preset enlazado, columnas de
 *  `AiModel` cargadas a mano) también puede ser Sonnet u Opus. */
function esMotorPremium(providerModel: string): boolean {
  return /sonnet|opus/i.test(providerModel);
}

/** Mismo criterio que `modosDeRespaldoLogueados` más arriba: una
 *  combinación motor+rol se loguea UNA SOLA VEZ por proceso. */
const motoresPremiumSinPresupuestoLogueados = new Set<string>();

/**
 * T15 (motor-claude, `pulido.ts`): resolución ad-hoc modo→preset para un
 * paso que no es ni `creation` ni `adjustment` de ningún modo — el pulido
 * visual siempre pide Sonnet, sin importar qué modo esté activo. Mismo
 * respaldo que el resto del catálogo: `null` si ningún motor habilitado
 * tiene ese preset (el llamador decide — `pulir.ts` no corre el paso sin
 * esto).
 */
export async function motorParaPresetYEsfuerzo(spec: RoleSpec, filasOverride?: FilaConProveedor[]): Promise<ProviderConfig | null> {
  const filas = filasOverride ?? (await filasDelCatalogo());
  return motorPorPresetKey(filas, spec);
}

/** Mismos presets/esfuerzo que `crea-sonnet`/`crea-opus`/`todo-sonnet`/
 *  `todo-opus` en `modos-generacion.ts` para el rol `creation` — T14 no
 *  inventa un esfuerzo nuevo, reusa el ya medido. */
const ROLE_SPEC_POR_TIER_AUTOMATICO: Record<TierAutomatico, RoleSpec> = {
  haiku: HAIKU_LOW,
  sonnet: { presetKey: 'claude-sonnet-5-5', effort: 'medium' },
  opus: { presetKey: 'claude-opus-5-5', effort: 'medium' },
};

/**
 * T14 (motor-claude): resuelve el rol `creation`/`adjustment` del modo
 * `automatico`. Nunca pasa por `resolverRolDeModo` (sus roles no son fijos
 * como los de `MODES`) — en cambio:
 *
 *  - `creation`: el tier que decide `tierAutomaticoActual` (pacing por
 *    crédito del ciclo), resuelto al motor habilitado de ese preset. Si ese
 *    preset no tiene ningún motor habilitado, cae al preset de Haiku
 *    (mismo criterio de respaldo que `resolverRolDeModo`).
 *  - `adjustment`: "model stickiness" (T14 punto 1) — el motor con el que
 *    ESE proyecto nació (`project.creationModelId`), mientras siga
 *    habilitado y con clave utilizable. Sin eso (proyecto de antes de esta
 *    columna, o el motor que lo creó ya no está disponible), cae a
 *    `HAIKU_LOW` — igual que el resto de los modos cuando ajustan sin un
 *    motor "pegado" mejor a mano.
 */
async function motorAutomatico(
  esCreacion: boolean,
  creationModelId: string | null,
  settings: { billingCycleDay: number; monthlyCreditUsd: number; premiumUntilUsd: number },
  filasOverride?: FilaConProveedor[],
): Promise<ProviderConfig | null> {
  const filas = filasOverride ?? (await filasDelCatalogo());

  if (!esCreacion && creationModelId) {
    const fila = filas.find((candidata) => candidata.id === creationModelId && utilizable(candidata));
    if (fila) {
      const config = construirConfig(fila);
      if (tieneClaveUtilizable(config)) return config;
    }
    // Motor de creación apagado/borrado/sin clave: cae al respaldo de abajo.
  }

  if (!esCreacion) {
    return motorPorPresetKey(filas, HAIKU_LOW);
  }

  const decision = await tierAutomaticoActual(settings);
  const directo = motorPorPresetKey(filas, ROLE_SPEC_POR_TIER_AUTOMATICO[decision.tier]);
  if (directo) return directo;
  return motorPorPresetKey(filas, HAIKU_LOW);
}

export async function motorDeGeneracion(params: {
  modelIdExplicitoDelPedido: string | null;
  /** T14: `creationModelId` es el motor con el que ESTE proyecto nació
   *  ("stickiness") — sólo lo lee el modo `automatico` (`motorAutomatico`),
   *  los demás modos ni lo miran. `null`/`undefined` en todo proyecto
   *  anterior a esta columna: se comporta como si no hubiera sticky. */
  project: { aiModelId: string | null; engineChosenByTeacher: boolean; creationModelId?: string | null };
  esCreacion: boolean;
  settings: {
    generationMode: string;
    creationModelId: string | null;
    adjustmentModelId: string | null;
    /** T14: sólo los lee el modo `automatico` (`tierAutomaticoActual`) —
     *  opcionales para no romper ningún llamador/prueba de antes de T14 que
     *  nunca puede activar ese modo (`billingCycleDay` default 1,
     *  `monthlyCreditUsd`/`premiumUntilUsd` default 0, que con el pacing de
     *  arriba decide `haiku` siempre — nunca un crash por faltar un número). */
    billingCycleDay?: number;
    monthlyCreditUsd?: number;
    premiumUntilUsd?: number;
  };
  /**
   * Hallazgo de revisión (motor-claude, pre-deploy): el recorte premium
   * (`modos-generacion.ts#presupuestoPremiumAgotado`) también tiene que
   * aplicar a un motor elegido EXPLÍCITAMENTE por el docente — antes de
   * esto, `engineChosenByTeacher` se saltaba el recorte entero, así que un
   * docente que eligió Sonnet/Opus a mano seguía pagando ese motor aun con
   * el presupuesto del ciclo agotado.
   *
   * Es una FUNCIÓN perezosa, no un booleano ya calculado: sólo se invoca
   * (y sólo entonces se paga la consulta de gasto que hace, ver
   * `gastoDelCicloActual` en `stream.ts`/`autocorreccion.ts`/`verificar.ts`)
   * cuando el motor elegido por el docente resulta ser Sonnet/Opus — un
   * proyecto con Haiku (o cualquier otro motor no premium) elegido a mano
   * sigue sin pagar esa consulta en cada turno, exactamente como antes de
   * este fix. `undefined` = el llamador no la pasó (pruebas viejas, o un
   * futuro llamador sin acceso al gasto del ciclo) — tratado como "nunca
   * agotado", el comportamiento de siempre.
   */
  presupuestoPremiumAgotado?: () => Promise<boolean>;
  /** Ver el comentario de `resolverRolDeModo` — sólo para pruebas unitarias. */
  filasOverride?: FilaConProveedor[];
}): Promise<ProviderConfig | null> {
  if (params.project.engineChosenByTeacher) {
    const explicito = await normalizarMotor(params.modelIdExplicitoDelPedido ?? params.project.aiModelId);
    const role = params.esCreacion ? 'creation' : 'adjustment';

    if (explicito && esMotorPremium(explicito.model) && params.presupuestoPremiumAgotado && (await params.presupuestoPremiumAgotado())) {
      const clave = `${explicito.id}:${role}`;
      if (!motoresPremiumSinPresupuestoLogueados.has(clave)) {
        motoresPremiumSinPresupuestoLogueados.add(clave);
        console.warn(
          `[catalogo] motor elegido por el docente (${explicito.label}) es premium y el presupuesto del ciclo ya se agotó — se usa el rol base en su lugar.`,
        );
      }

      const base = await resolverRolDeModo(
        'base',
        role,
        { creationModelId: params.settings.creationModelId, adjustmentModelId: params.settings.adjustmentModelId },
        params.filasOverride,
      );
      if (base) return base;
      // Sin un motor base habilitado tampoco (admin no cargó el preset de
      // Haiku): mejor el motor premium elegido que nada — mismo criterio
      // "nunca un 503 evitable" que el resto de esta función.
    }

    return explicito;
  }

  if (params.settings.generationMode === MODO_AUTOMATICO_KEY) {
    const porAutomatico = await motorAutomatico(
      params.esCreacion,
      params.project.creationModelId ?? null,
      {
        billingCycleDay: params.settings.billingCycleDay ?? 1,
        monthlyCreditUsd: params.settings.monthlyCreditUsd ?? 0,
        premiumUntilUsd: params.settings.premiumUntilUsd ?? 0,
      },
      params.filasOverride,
    );
    return porAutomatico ?? normalizarMotor(params.modelIdExplicitoDelPedido ?? params.project.aiModelId);
  }

  const porModo = await resolverRolDeModo(
    params.settings.generationMode,
    params.esCreacion ? 'creation' : 'adjustment',
    {
      creationModelId: params.settings.creationModelId,
      adjustmentModelId: params.settings.adjustmentModelId,
    },
    params.filasOverride,
  );

  return porModo ?? normalizarMotor(params.modelIdExplicitoDelPedido ?? params.project.aiModelId);
}
