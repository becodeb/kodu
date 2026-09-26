import { prisma } from '../db.ts';
import type { AiModel, AiProvider } from '../../generated/prisma/client.ts';
import { ClaveInvalida, ClaveNoConfigurada, descifrar } from '../crypto/secretos.ts';
import type { ProviderConfig } from './provider.ts';
import type { MotorPublico } from '../workspace-types.ts';

/** Una fila de `AiModel` con su cuenta de proveedor ya incluida. */
type FilaConProveedor = AiModel & { provider: AiProvider };

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

/**
 * Un motor sirve sólo si están prendidos los dos: el motor y su cuenta —
 * y, si es `primeOnly` (T5, odd/tasks/modo-prime.md), sólo para un pedido
 * con prime. `prime` es del CALLER (qué puede este pedido, no del motor), así
 * que viaja como parámetro en vez de leerse de algún lado acá adentro: este
 * módulo no sabe nada de usuarios ni de `AppSettings`, sólo filtra con lo que
 * le pasan — ver `resolverCapacidades` en `lib/ai/capacidades.ts`.
 */
function utilizable(fila: FilaConProveedor, prime: boolean): boolean {
  if (fila.primeOnly && !prime) return false;
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
  const precios =
    fila.priceInputPerMToken !== null && fila.priceOutputPerMToken !== null
      ? {
          input: fila.priceInputPerMToken,
          output: fila.priceOutputPerMToken,
          cachedInput: fila.priceCachedInputPerMToken,
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
    // T2 (verificador): cualquier valor que no sea "responses" se trata como
    // "chat" — mismo criterio defensivo que el resto de este archivo (nunca
    // un throw por un dato de fila inesperado, ver `clavePlano` más arriba).
    apiFormat: fila.provider.apiFormat === 'responses' ? 'responses' : 'chat',
    model: fila.providerModel,
    maxTokens: fila.maxOutputTokens,
    userTokenLimit: fila.userTokenLimit,
    userTokenWindowHours: fila.userTokenWindowHours,
    maxInputChars: fila.maxInputChars,
    supportsVision: fila.supportsVision,
    reasoningEffort: fila.reasoningEffort,
    reasoningParam: fila.reasoningParam,
    precios,
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
 *
 * `prime` importa sobre todo para esa segunda rama: un motor `isDefault`
 * nunca es `primeOnly` (se valida en `/api/admin/models`), pero la caída al
 * de menor `sortOrder` SÍ podría aterrizar en uno prime-only si no se
 * filtrara acá — un docente sin prime se quedaría, por accidente, con un
 * motor que nunca debería poder usar.
 */
export async function motorPorDefecto(prime: boolean): Promise<ProviderConfig | null> {
  const filas = await filasDelCatalogo();

  const porDefecto = filas.find((fila) => fila.isDefault && utilizable(fila, prime));
  if (porDefecto) return construirConfig(porDefecto);

  const [habilitado] = filas.filter((fila) => utilizable(fila, prime)).sort((a, b) => a.sortOrder - b.sortOrder);
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
 *
 * T5 (odd/tasks/modo-prime.md): un motor `primeOnly` pedido por (o guardado
 * en el proyecto de) alguien sin prime cae al default EXACTAMENTE por el
 * mismo camino que un motor apagado o inexistente — no hay un tercer caso
 * especial. `prime` lo resuelve `resolverCapacidades` (`lib/ai/capacidades.ts`)
 * antes de llamar acá; esta función no sabe nada de usuarios.
 */
export async function normalizarMotor(modelId: string | null, prime: boolean): Promise<ProviderConfig | null> {
  const filas = await filasDelCatalogo();
  const fila = modelId ? filas.find((candidata) => candidata.id === modelId) : undefined;

  if (fila && utilizable(fila, prime)) return construirConfig(fila);

  return motorPorDefecto(prime);
}

/**
 * T3 (verificador, odd/tasks/verificador.md): el motor marcado
 * `isVerifier: true`, si está USABLE (motor y cuenta prendidos, con clave
 * cargada) — `null` en cualquier otro caso: sin ningún motor marcado, motor
 * o cuenta apagados, o sin clave utilizable. Ese `null` es exactamente "el
 * verificador está apagado" para `POST /api/chat/verificar`.
 *
 * A diferencia de `motorPorDefecto`/`normalizarMotor`, no recibe `prime`: el
 * verificador no es una feature que un docente elija, corre solo del lado
 * del servidor después de la autoprueba — no hay ningún actor cuya
 * capacidad haya que filtrar acá.
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
 *
 * T5: un eslabón `primeOnly` para un pedido sin prime sigue exactamente ese
 * mismo criterio — no entra a la cadena, pero la traversal SÍ sigue por su
 * `fallbackModelId` hacia el próximo eslabón. Nunca es "la cadena se corta
 * acá", siempre "se saltea este paso".
 */
export async function cadenaDeMotores(desdeId: string | null, prime: boolean): Promise<ProviderConfig[]> {
  const filas = await filasDelCatalogo();
  const porId = new Map(filas.map((fila) => [fila.id, fila]));

  let actualId = desdeId ?? (await motorPorDefecto(prime))?.id ?? null;
  const cadena: ProviderConfig[] = [];
  const visitados = new Set<string>();

  while (actualId && cadena.length < TOPE_CADENA && !visitados.has(actualId)) {
    visitados.add(actualId);
    const fila = porId.get(actualId);
    if (!fila) break;

    if (utilizable(fila, prime)) {
      const config = construirConfig(fila);
      if (tieneClaveUtilizable(config)) cadena.push(config);
    }

    actualId = fila.fallbackModelId;
  }

  if (cadena.length === 0) {
    const porDefecto = await motorPorDefecto(prime);
    if (porDefecto) cadena.push(porDefecto);
  }

  return cadena;
}

/**
 * Lo que puede elegir un docente: habilitados Y `selectableByTeacher`, sin
 * `provider`/`providerModel` (identificadores internos), sin claves ni
 * precios. Ya en el orden configurado (`filasDelCatalogo` ordena por
 * `sortOrder`).
 *
 * T5: un motor `primeOnly` nunca aparece acá para un pedido sin prime — esta
 * es la lista que arma el selector del docente en `project/[id].astro`, así
 * que filtrar acá (server-side) es lo que hace que el filtro del cliente sea
 * sólo cosmético, nunca la única defensa.
 */
export async function motoresParaDocente(prime: boolean): Promise<MotorPublico[]> {
  const filas = await filasDelCatalogo();

  return filas
    .filter((fila) => utilizable(fila, prime) && fila.selectableByTeacher)
    .map((fila) => ({
      id: fila.id,
      displayName: fila.displayName,
      description: fila.description,
      supportsVision: fila.supportsVision,
    }));
}
