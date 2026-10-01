import 'dotenv/config';
import { execFileSync } from 'node:child_process';

/**
 * odd/tasks/planes-y-cobros.md (T9): UN solo comando (`npm run test:cobros`)
 * que corre todos los chequeos de planes, créditos y cobros, en orden:
 *
 *   1. Unitarios sin servidor: unidad-planes, unidad-creditos,
 *      unidad-pasarela, unidad-facturador.
 *   2. Arranca (si hace falta) el dev server de ESTE worktree con
 *      BILLING_PROVIDER=simulado e INVOICE_PROVIDER=simulado.
 *   3. e2e contra ese servidor, en el orden pedido: planes-acceso,
 *      planes-alta, planes-cobro, planes-paginas, planes-superadmin,
 *      planes-facturacion, planes-recorrido.
 *   4. Para el dev server (sólo si lo arrancamos nosotros) y muestra una
 *      tabla final con resultado y duración de cada script.
 *
 * Por qué el dev server se arranca/para CENTRALIZADO acá, aunque algunos de
 * estos e2e YA saben arrancar y parar su propio dev server
 * (planes-alta.ts/planes-paginas.ts/planes-superadmin.ts): esos tres dejan el
 * servidor en estados distintos al terminar (planes-alta.ts lo deja
 * CORRIENDO de nuevo con un entorno limpio; planes-paginas.ts y
 * planes-superadmin.ts lo paran). Qué hace cada script con el servidor no es
 * algo que este orquestador tenga que adivinar: antes de cada script que
 * espera un servidor YA levantado (planes-acceso, planes-cobro,
 * planes-facturacion, planes-recorrido) se confirma que responda y, si no,
 * se arranca uno. El entorno (`BILLING_PROVIDER`, `INVOICE_PROVIDER`,
 * `RESEND_API_KEY` vacía) se pasa en `process.env` a CADA script hijo, así
 * que cualquier reinicio que un script haga por su cuenta (todos spread
 * `...process.env` en su propio `arrancarDevServer`) hereda el mismo entorno.
 *
 * Guarda de base de datos (documentada, no sólo en código): este script NUNCA
 * corre si `DATABASE_URL` (o `POSTGRES_DB`) contiene la palabra "prod"
 * (sin importar mayúsculas) o si `NODE_ENV=production` — ver `guardaBaseDeDatos()`
 * más abajo. No es una whitelist de hosts (no conocemos todos los nombres de
 * base de desarrollo posibles de antemano): es una blacklist mínima para que
 * un `.env` apuntado por error a producción nunca llegue a dropear/sembrar
 * datos reales. Si tu base de desarrollo se llama justo "produccion_test" o
 * algo que matchee "prod" sin serlo, renombrala — no se agregan excepciones
 * a esta regla.
 *
 * Uso: `npm run test:cobros` (usa PORT=3200 por defecto; `PORT=3210 npm run
 * test:cobros` corre contra otro puerto). Requiere Postgres arriba
 * (`docker compose up -d db`, o un Postgres propio) y las migraciones al día
 * (`npm run db:deploy && npm run db:seed`).
 */

const PORT = process.env.PORT ? Number(process.env.PORT) : 3200;
const BASE_URL = process.env.KODU_BASE_URL ?? `http://localhost:${PORT}`;

const ENV_HIJOS: Record<string, string> = {
  ...toStringRecord(process.env),
  PORT: String(PORT),
  KODU_BASE_URL: BASE_URL,
  BILLING_PROVIDER: 'simulado',
  INVOICE_PROVIDER: 'simulado',
  RESEND_API_KEY: '',
  RESEND_FROM: '',
  RESEND_API_URL: '',
};

function toStringRecord(env: NodeJS.ProcessEnv): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(env)) {
    if (typeof valor === 'string') salida[clave] = valor;
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────
// Guarda: nunca contra una base que parezca de producción.
// ─────────────────────────────────────────────────────────────

function guardaBaseDeDatos(): void {
  const nodeEnv = (process.env.NODE_ENV ?? '').toLowerCase();
  const databaseUrl = (process.env.DATABASE_URL ?? '').toLowerCase();
  const postgresDb = (process.env.POSTGRES_DB ?? '').toLowerCase();

  if (nodeEnv === 'production') {
    abortar('NODE_ENV=production. Este script nunca corre contra producción.');
  }
  if (databaseUrl.includes('prod') || postgresDb.includes('prod')) {
    abortar(
      `DATABASE_URL o POSTGRES_DB contiene "prod" (DATABASE_URL="${process.env.DATABASE_URL ?? ''}", ` +
        `POSTGRES_DB="${process.env.POSTGRES_DB ?? ''}"). Este script nunca corre contra algo que PAREZCA producción.`,
    );
  }
  if (!process.env.DATABASE_URL) {
    abortar('Falta DATABASE_URL en el entorno.');
  }
}

function abortar(motivo: string): never {
  console.error(`\n✖ Abortado antes de tocar nada: ${motivo}\n`);
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Ciclo de vida del dev server — mismo runbook que e2e/planes-alta.ts.
// ─────────────────────────────────────────────────────────────

function pararDevServer(): void {
  try {
    execFileSync('npx', ['astro', 'dev', 'stop'], { stdio: 'pipe' });
  } catch {
    // No había ninguno corriendo.
  }
}

function arrancarDevServer(): void {
  execFileSync('npx', ['astro', 'dev', '--port', String(PORT), '--background'], {
    env: { ...ENV_HIJOS },
    stdio: 'pipe',
  });
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function servidorResponde(): Promise<boolean> {
  try {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 1_000);
    const respuesta = await fetch(`${BASE_URL}/login`, { signal: controlador.signal });
    clearTimeout(temporizador);
    // Cualquier respuesta HTTP (incluso un error de la app) significa que
    // ALGO está escuchando en el puerto — eso es lo único que nos importa acá.
    return respuesta.status > 0;
  } catch {
    return false;
  }
}

async function esperarListo(timeoutMs = 20_000): Promise<void> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await servidorResponde()) return;
    await esperar(300);
  }
  throw new Error(`El dev server no respondió en ${BASE_URL} después de ${timeoutMs}ms.`);
}

/** Si nadie responde en el puerto, arranca el dev server de este worktree. */
async function asegurarServidorArriba(): Promise<void> {
  if (await servidorResponde()) return;
  arrancarDevServer();
  await esperarListo();
}

// ─────────────────────────────────────────────────────────────
// Corrida de cada script + tabla de resultados.
// ─────────────────────────────────────────────────────────────

type TipoDeServidor = 'sin-servidor' | 'ya-levantado' | 'se-arranca-y-para-solo';

interface Paso {
  nombre: string;
  archivo: string;
  servidor: TipoDeServidor;
}

const PASOS: Paso[] = [
  { nombre: 'unidad-planes', archivo: 'e2e/unidad-planes.ts', servidor: 'sin-servidor' },
  { nombre: 'unidad-creditos', archivo: 'e2e/unidad-creditos.ts', servidor: 'sin-servidor' },
  { nombre: 'unidad-pasarela', archivo: 'e2e/unidad-pasarela.ts', servidor: 'sin-servidor' },
  { nombre: 'unidad-facturador', archivo: 'e2e/unidad-facturador.ts', servidor: 'sin-servidor' },
  { nombre: 'planes-acceso', archivo: 'e2e/planes-acceso.ts', servidor: 'ya-levantado' },
  { nombre: 'planes-alta', archivo: 'e2e/planes-alta.ts', servidor: 'se-arranca-y-para-solo' },
  { nombre: 'planes-cobro', archivo: 'e2e/planes-cobro.ts', servidor: 'ya-levantado' },
  { nombre: 'planes-paginas', archivo: 'e2e/planes-paginas.ts', servidor: 'se-arranca-y-para-solo' },
  { nombre: 'planes-superadmin', archivo: 'e2e/planes-superadmin.ts', servidor: 'se-arranca-y-para-solo' },
  { nombre: 'planes-facturacion', archivo: 'e2e/planes-facturacion.ts', servidor: 'ya-levantado' },
  { nombre: 'planes-recorrido', archivo: 'e2e/planes-recorrido.ts', servidor: 'ya-levantado' },
];

interface Resultado {
  nombre: string;
  ok: boolean;
  duracionMs: number;
}

// `execFileSync` ya alcanza (no necesitamos stdout/stderr capturados: se
// heredan para que se vea el progreso de cada script en vivo mientras corre).
function correr(archivo: string): boolean {
  try {
    execFileSync('npx', ['tsx', archivo], { env: { ...ENV_HIJOS }, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  guardaBaseDeDatos();

  // Preflight: si YA hay algo respondiendo en el puerto ANTES de que
  // toquemos nada, no es nuestro — nunca lo tocamos ni lo paramos.
  if (await servidorResponde()) {
    abortar(
      `Ya hay algo respondiendo en ${BASE_URL} (puerto ${PORT}) antes de empezar. ` +
        `No lo vamos a tocar: pará lo que esté corriendo ahí (¿otro "npm run dev"? ` +
        `¿"npx astro dev stop" a mano?) o corré este script con otro PORT.`,
    );
  }

  const resultados: Resultado[] = [];
  let huboFallas = false;

  for (const paso of PASOS) {
    if (paso.servidor === 'ya-levantado') {
      await asegurarServidorArriba();
    }

    console.log(`\n${'─'.repeat(70)}\n▶ ${paso.nombre} (${paso.archivo})\n${'─'.repeat(70)}`);
    const inicio = Date.now();
    const ok = correr(paso.archivo);
    const duracionMs = Date.now() - inicio;
    resultados.push({ nombre: paso.nombre, ok, duracionMs });
    if (!ok) huboFallas = true;
  }

  // Todo lo que esté corriendo en este puerto a esta altura es nuestro: el
  // preflight de arriba confirmó que el puerto estaba libre antes de que
  // tocáramos algo, así que es seguro pararlo (nunca con pkill -f).
  pararDevServer();

  imprimirTabla(resultados);

  if (huboFallas) process.exit(1);
}

function imprimirTabla(resultados: Resultado[]): void {
  console.log(`\n${'═'.repeat(70)}`);
  console.log('Resumen — npm run test:cobros');
  console.log('═'.repeat(70));
  const anchoNombre = Math.max(20, ...resultados.map((r) => r.nombre.length));
  for (const r of resultados) {
    const estado = r.ok ? '✔ OK   ' : '✖ FALLÓ';
    const duracion = `${(r.duracionMs / 1000).toFixed(1)}s`.padStart(8);
    console.log(`  ${r.nombre.padEnd(anchoNombre)}  ${estado}  ${duracion}`);
  }
  const total = resultados.reduce((acc, r) => acc + r.duracionMs, 0);
  const fallados = resultados.filter((r) => !r.ok).length;
  console.log('─'.repeat(70));
  console.log(
    fallados === 0
      ? `  ${resultados.length} script(s), todos verdes. Total: ${(total / 1000).toFixed(1)}s`
      : `  ${fallados} de ${resultados.length} script(s) fallaron. Total: ${(total / 1000).toFixed(1)}s`,
  );
  console.log('═'.repeat(70));
}

main().catch((error) => {
  console.error('\n✖ scripts/probar-cobros.ts falló:', error);
  try {
    pararDevServer();
  } catch {
    // mejor esfuerzo
  }
  process.exit(1);
});
