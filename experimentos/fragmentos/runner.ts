import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import { hashPassword } from '../../src/lib/auth/password.ts';
import { createProject } from '../../src/lib/projects.ts';

/**
 * odd/tasks/ahorro-tokens.md (T3b): mide costo/calidad real de
 * `edit_resource_code` (T3a) contra DeepSeek de verdad, con la clave de
 * PRUEBA (`DEEPSEEK_TEST_API_KEY`, NUNCA impresa ni commiteada).
 *
 * Maneja los 3 recursos del corpus (`casos.json`) × 2 pedidos cada uno × 2
 * modos (interruptor apagado = rewrite completo / prendido = fragmentos) =
 * 12 llamadas reales, cada una un turno de AJUSTE de verdad contra
 * `/api/chat/stream` del server local (así se ejercitan el prompt, las
 * herramientas y el registro de costo reales, no un mock).
 *
 * Corta si el gasto (diferencia de saldo) llega a USD 0.30.
 *
 * Salida: experimentos/fragmentos/resultados/<caso>__<pedido>__<modo>.html
 * (el HTML final de cada corrida) + experimentos/fragmentos/resumen.json
 * (tabla de tokens/costo/duración/resultado de edición por caso) +
 * experimentos/fragmentos/ciego/ (paquete de evaluación ciega).
 *
 * Corre con: npx tsx experimentos/fragmentos/runner.ts
 * Requiere: DEEPSEEK_TEST_API_KEY cargada en el entorno (nunca hardcodeada
 * acá), y el server de desarrollo levantado en KODU_BASE_URL (PORT 3300).
 *
 * HISTORICAL ARTIFACT (odd/tasks/ahorro-tokens.md, T6): after the T3c blind
 * evaluation (fragments never lost: 3 wins, 3 ties, 9.3 vs 7.6 average), the
 * owner made fragment editing the only edit path — T6 removed
 * `AppSettings.fragmentEditsEnabled` entirely. `fijarInterruptor` below can
 * no longer toggle "full" mode (there is nothing left to toggle; the first
 * attempt of an adjustment now ALWAYS offers only `edit_resource_code`), so
 * this file is kept only as a record of how the T3b real-money measurement
 * was run. `fijarInterruptor` was adapted to a no-op that documents this
 * instead of being deleted, so the surrounding A/B loop stays readable; do
 * not re-run as-is expecting a real "full" column.
 */

const BASE_URL = process.env.KODU_BASE_URL ?? 'http://localhost:3300';
const DOCENTE_EMAIL = 'docente-e2e-fragmentos-t3b@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.T3B.2026';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@rededucativa.edu.ar';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'Kodu.Admin.2026';
const PROVIDER_KIND = 'deepseek-experimento-t3b';
const PRESUPUESTO_USD = 0.3;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

interface Pedido {
  tipo: 'visual' | 'logica';
  mensaje: string;
}

interface Caso {
  id: string;
  titulo: string;
  fuenteHtml: string;
  pedidos: Pedido[];
}

interface ResultadoCorrida {
  caso: string;
  pedidoTipo: string;
  mensaje: string;
  modo: 'full' | 'fragments';
  promptTokens: number;
  cachedInputTokens: number;
  completionTokens: number;
  costUsd: number | null;
  editMode: string | null;
  durationMs: number;
  htmlFile: string;
}

function apiKey(): string {
  const k = process.env.DEEPSEEK_TEST_API_KEY;
  if (!k) throw new Error('DEEPSEEK_TEST_API_KEY no está en el entorno. Cargala con: set -a; . ~/.credentials/deepseek-kodu-prueba.env; set +a');
  return k;
}

async function leerBalanceUsd(): Promise<number> {
  const resp = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!resp.ok) throw new Error(`DeepSeek /user/balance: HTTP ${resp.status}`);
  const body = (await resp.json()) as {
    balance_infos: { currency: string; total_balance: string }[];
  };
  const usd = body.balance_infos.find((b) => b.currency === 'USD') ?? body.balance_infos[0];
  if (!usd) throw new Error('DeepSeek /user/balance: respuesta sin balance_infos');
  return Number(usd.total_balance);
}

async function asegurarDocenteDePrueba(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: {
      email: DOCENTE_EMAIL,
      name: 'Docente E2E T3b (costo real)',
      role: 'DOCENTE',
      passwordHash: await hashPassword(DOCENTE_PASSWORD),
    },
  });
  return user.id;
}

/** Provider/modelo DeepSeek de verdad, apuntando a la API real, espejo de
 *  producción (deepseek-flash) salvo por `reasoningEffort: 'low'`, pedido
 *  explícitamente para este experimento. */
async function asegurarProveedorDeepSeekReal(): Promise<{ providerId: string; modelId: string }> {
  let provider = await prisma.aiProvider.findFirst({ where: { kind: PROVIDER_KIND } });
  if (!provider) {
    // La clave se cifra server-side (`cifrar`, src/lib/crypto/secretos.ts) —
    // nunca se guarda en texto plano. Se crea por Prisma directo (no por la
    // API de admin) para no tener que loguearse como admin acá; se cifra
    // con la MISMA función que usa el endpoint real.
    const { cifrar } = await import('../../src/lib/crypto/secretos.ts');
    const id = crypto.randomUUID();
    const apiKeyCipher = cifrar(apiKey(), id);
    provider = await prisma.aiProvider.create({
      data: {
        id,
        kind: PROVIDER_KIND,
        label: 'DeepSeek real (experimento T3b, odd/tasks/ahorro-tokens.md)',
        baseUrl: 'https://api.deepseek.com',
        apiKeyCipher,
        apiKeyHint: apiKey().slice(-4),
        enabled: true,
      },
    });
  }

  let model = await prisma.aiModel.findFirst({ where: { providerId: provider.id, providerModel: 'deepseek-flash' } });
  if (!model) {
    model = await prisma.aiModel.create({
      data: {
        id: crypto.randomUUID(),
        providerId: provider.id,
        providerModel: 'deepseek-flash',
        displayName: 'DeepSeek real (experimento T3b)',
        selectableByTeacher: false,
        maxOutputTokens: 131_072,
        maxInputChars: 400_000,
        reasoningEffort: 'low',
        reasoningParam: 'reasoning_effort',
        // Precios reales de producción (deepseek-flash, leídos de un AiModel
        // ya cargado en esta misma base): input 0.15, output 0.6, cached
        // input 0.003 USD/millón de tokens, factor fuera de pico 0.5 (T1).
        // Así TokenUsage.costUsd refleja el costo real, no null.
        priceInputPerMToken: 0.15,
        priceOutputPerMToken: 0.6,
        priceCachedInputPerMToken: 0.003,
        priceOffPeakFactor: 0.5,
        peakWindowsUtc: [1, 2, 3, 4, 5].flatMap((weekday) => [
          { weekday, startHour: 1, endHour: 4 },
          { weekday, startHour: 6, endHour: 10 },
        ]),
      },
    });
  }

  return { providerId: provider.id, modelId: model.id };
}

/** Reusa el mismo `createProject` que usa la API real (`POST /api/projects`,
 *  `src/lib/projects.ts`): arma el slug único y el primer hilo igual que un
 *  proyecto de verdad. El `html` base del corpus viaja directo como HTML de
 *  arranque — así el ajuste de este experimento parte de un recurso YA
 *  existente (nunca del HTML de arranque por defecto), `recursoInicial`
 *  da `false` y el interruptor de edición por fragmentos entra en juego. */
async function crearProyectoConHtml(userId: string, titulo: string, html: string, modelId: string): Promise<{ id: string; threadId: string }> {
  const project = await createProject({ userId, title: titulo, html });
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  const thread = project.threads[0]!;
  return { id: project.id, threadId: thread.id };
}

async function iniciarSesionCookie(email: string, password: string): Promise<string> {
  const resp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!resp.ok) throw new Error(`login (${email}) falló: ${resp.status} ${await resp.text()}`);
  const setCookie = resp.headers.get('set-cookie');
  if (!setCookie) throw new Error('login no devolvió cookie');
  return setCookie.split(';')[0]!;
}

async function mandarTurnoReal(args: {
  cookie: string;
  projectId: string;
  threadId: string;
  modelId: string;
  mensaje: string;
}): Promise<{ tipos: string[]; htmlFinal: string | null }> {
  const resp = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: args.cookie },
    body: JSON.stringify({ projectId: args.projectId, threadId: args.threadId, message: args.mensaje, model: args.modelId }),
  });
  if (!resp.ok) throw new Error(`/api/chat/stream: HTTP ${resp.status} ${await resp.text()}`);

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const tipos: string[] = [];
  let htmlFinal: string | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const crudo = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf('\n\n');
      const data = crudo.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data || data === '[DONE]') continue;
      try {
        const evt = JSON.parse(data) as { type: string; html?: string };
        tipos.push(evt.type);
        if (evt.type === 'code' && evt.html) htmlFinal = evt.html;
      } catch {
        /* keepalive comment */
      }
    }
  }
  return { tipos, htmlFinal };
}

/**
 * odd/tasks/ahorro-tokens.md (T3b), lección de esta misma corrida: un
 * `prisma.appSettings.update()` directo cambia la fila pero NO invalida el
 * caché de 10s de `leerAppSettings()` que vive en el PROCESO del server de
 * desarrollo — este script corre en un proceso Node separado, así que nunca
 * puede tocar esa variable de módulo. El servidor sólo refresca su caché
 * cuando pasan 10s desde la última lectura, y con el server bajo carga
 * (una llamada real detrás de otra) eso nunca terminaba de pasar: el
 * interruptor quedó pegado en "prendido" después del primer toggle y los
 * turnos "full" que seguían, en la práctica, se resolvían igual con
 * `edit_resource_code` (el modelo real SÍ puede elegir usarlo si el tool
 * sigue ofrecido). Única vía confiable: el mismo endpoint admin que usa la
 * UI (`PATCH /api/admin/settings`), que llama `invalidarAppSettings()` en
 * el MISMO proceso que `leerAppSettings()`.
 */
// T6: no-op — `AppSettings.fragmentEditsEnabled` no existe más (ver el
// comentario HISTORICAL ARTIFACT de arriba). Se deja la firma para que el
// resto del archivo (el loop de más abajo) siga siendo legible como registro
// de cómo corrió T3b; no hay ningún interruptor que fijar hoy.
async function fijarInterruptor(_cookieAdmin: string, _valor: boolean): Promise<void> {
  return Promise.resolve();
}

async function main(): Promise<void> {
  const resultadosDir = new URL('./resultados/', import.meta.url).pathname;
  const ciegoDir = new URL('./ciego/', import.meta.url).pathname;
  await mkdir(resultadosDir, { recursive: true });
  await mkdir(ciegoDir, { recursive: true });

  const balanceAntes = await leerBalanceUsd();
  console.log(`Saldo DeepSeek ANTES: USD ${balanceAntes.toFixed(4)}`);

  const userId = await asegurarDocenteDePrueba();
  const { modelId } = await asegurarProveedorDeepSeekReal();
  const cookie = await iniciarSesionCookie(DOCENTE_EMAIL, DOCENTE_PASSWORD);
  const cookieAdmin = await iniciarSesionCookie(ADMIN_EMAIL, ADMIN_PASSWORD);

  const casosRaw = await readFile(new URL('./casos.json', import.meta.url), 'utf-8');
  const casos = JSON.parse(casosRaw) as Caso[];

  const resultados: ResultadoCorrida[] = [];
  let gastoAcumulado = 0;

  for (const caso of casos) {
    const htmlBase = await readFile(caso.fuenteHtml, 'utf-8');

    for (const pedido of caso.pedidos) {
      const baseVsLabeled: { modo: 'full' | 'fragments'; html: string | null }[] = [];

      for (const modo of ['full', 'fragments'] as const) {
        const balanceCheckAntes = await leerBalanceUsd();
        if (balanceAntes - balanceCheckAntes >= PRESUPUESTO_USD) {
          console.warn(`Presupuesto de USD ${PRESUPUESTO_USD} alcanzado — se corta ANTES de ${caso.id}/${pedido.tipo}/${modo}.`);
          await escribirSalidas(resultados, resultadosDir, ciegoDir, casos, balanceAntes, balanceCheckAntes);
          return;
        }

        await fijarInterruptor(cookieAdmin, modo === 'fragments');
        // T6: ya no hay ningún interruptor que leer de vuelta para
        // confirmar — ver `fijarInterruptor` y el comentario HISTORICAL
        // ARTIFACT de arriba.

        // Proyecto NUEVO por caso (seedeado con `htmlBase`, no generado):
        // así el ajuste parte SIEMPRE del mismo HTML base, sea cual sea el
        // modo, y las dos corridas (full vs fragments) del mismo pedido son
        // comparables.
        const { id: projectId, threadId } = await crearProyectoConHtml(
          userId,
          `T3b ${caso.id} (${pedido.tipo}, ${modo})`,
          htmlBase,
          modelId,
        );

        const t0 = Date.now();
        const { tipos, htmlFinal } = await mandarTurnoReal({ cookie, projectId, threadId, modelId, mensaje: pedido.mensaje });
        const durationMs = Date.now() - t0;

        const usage = await prisma.tokenUsage.findFirst({
          where: { projectId, purpose: 'ADJUSTMENT' },
          orderBy: { createdAt: 'desc' },
        });

        const htmlFile = `${resultadosDir}${caso.id}__${pedido.tipo}__${modo}.html`;
        await writeFile(htmlFile, htmlFinal ?? '<!-- sin HTML final -->');

        resultados.push({
          caso: caso.id,
          pedidoTipo: pedido.tipo,
          mensaje: pedido.mensaje,
          modo,
          promptTokens: usage?.promptTokens ?? 0,
          cachedInputTokens: usage?.cachedInputTokens ?? 0,
          completionTokens: usage?.completionTokens ?? 0,
          costUsd: usage?.costUsd ? Number(usage.costUsd) : null,
          editMode: usage?.editMode ?? null,
          durationMs,
          htmlFile,
        });

        baseVsLabeled.push({ modo, html: htmlFinal });

        console.log(
          `✔ ${caso.id}/${pedido.tipo}/${modo}: prompt=${usage?.promptTokens} cached=${usage?.cachedInputTokens} ` +
            `completion=${usage?.completionTokens} cost=${usage?.costUsd ?? '?'} editMode=${usage?.editMode ?? 'null'} ` +
            `(${(durationMs / 1000).toFixed(1)}s, eventos: ${tipos.join(',')})`,
        );

        const balanceCheckDespues = await leerBalanceUsd();
        gastoAcumulado = balanceAntes - balanceCheckDespues;
      }

      // Paquete de evaluación ciega para ESTE pedido: A/B al azar.
      const [resFull, resFrag] = baseVsLabeled;
      const aEsFull = Math.random() < 0.5;
      const etiquetaA = aEsFull ? resFull : resFrag;
      const etiquetaB = aEsFull ? resFrag : resFull;
      const prefijo = `${caso.id}__${pedido.tipo}`;

      await writeFile(`${ciegoDir}${prefijo}__base.html`, htmlBase);
      await writeFile(`${ciegoDir}${prefijo}__pedido.txt`, pedido.mensaje);
      await writeFile(`${ciegoDir}${prefijo}__A.html`, etiquetaA?.html ?? '<!-- sin HTML -->');
      await writeFile(`${ciegoDir}${prefijo}__B.html`, etiquetaB?.html ?? '<!-- sin HTML -->');
      await writeFile(
        `${ciegoDir}${prefijo}__clave.json`,
        JSON.stringify({ A: etiquetaA?.modo, B: etiquetaB?.modo }, null, 2),
      );
    }
  }

  const balanceFinal = await leerBalanceUsd();
  await escribirSalidas(resultados, resultadosDir, ciegoDir, casos, balanceAntes, balanceFinal);
}

async function escribirSalidas(
  resultados: ResultadoCorrida[],
  resultadosDir: string,
  ciegoDir: string,
  casos: Caso[],
  balanceAntes: number,
  balanceDespues: number,
): Promise<void> {
  const resumen = {
    balanceAntesUsd: balanceAntes,
    balanceDespuesUsd: balanceDespues,
    gastoUsd: balanceAntes - balanceDespues,
    resultados,
  };
  await writeFile(new URL('./resumen.json', import.meta.url), JSON.stringify(resumen, null, 2));
  console.log(`\nSaldo DeepSeek DESPUÉS: USD ${balanceDespues.toFixed(4)} (gasto: USD ${(balanceAntes - balanceDespues).toFixed(4)})`);
  console.log(`Resumen escrito en experimentos/fragmentos/resumen.json`);
  console.log(`Paquete de evaluación ciega en ${ciegoDir}`);
}

await main();
await prisma.$disconnect();
