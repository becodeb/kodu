import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.ts';
import { hashPassword } from '../../src/lib/auth/password.ts';
import { createProject } from '../../src/lib/projects.ts';

/**
 * odd/tasks/ahorro-tokens.md (T3b): UNA llamada barata real contra DeepSeek
 * antes del experimento de 12 llamadas, para probar que el camino de
 * herramientas funciona con el modelo real (lección de una corrida previa:
 * una llamada auxiliar usó herramientas en silencio y se rompió, y los e2e
 * contra el mock no lo detectaron). Pedido CHICO a propósito (HTML corto,
 * un solo cambio) para gastar lo mínimo posible.
 *
 * Corre con: npx tsx experimentos/fragmentos/prueba-barata.ts
 *
 * HISTORICAL ARTIFACT (odd/tasks/ahorro-tokens.md, T6): after the T3c blind
 * evaluation, T6 removed `AppSettings.fragmentEditsEnabled` entirely —
 * fragment editing is now the only edit path for adjustments, always on,
 * with no switch left to toggle. The original `prisma.appSettings.update`
 * call that turned the switch off before this proof call was removed so
 * this file still compiles; everything else is kept as a record of how
 * T3b's real-money measurement was set up.
 */

const BASE_URL = process.env.KODU_BASE_URL ?? 'http://localhost:3300';
const DOCENTE_EMAIL = 'docente-e2e-fragmentos-t3b@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.T3B.2026';
const PROVIDER_KIND = 'deepseek-experimento-t3b';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function apiKey(): string {
  const k = process.env.DEEPSEEK_TEST_API_KEY;
  if (!k) throw new Error('DEEPSEEK_TEST_API_KEY no está en el entorno.');
  return k;
}

async function asegurarDocenteDePrueba(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email: DOCENTE_EMAIL },
    update: { role: 'DOCENTE' },
    create: { email: DOCENTE_EMAIL, name: 'Docente E2E T3b', role: 'DOCENTE', passwordHash: await hashPassword(DOCENTE_PASSWORD) },
  });
  return user.id;
}

async function asegurarProveedorDeepSeekReal(): Promise<string> {
  let provider = await prisma.aiProvider.findFirst({ where: { kind: PROVIDER_KIND } });
  if (!provider) {
    const { cifrar } = await import('../../src/lib/crypto/secretos.ts');
    const id = crypto.randomUUID();
    provider = await prisma.aiProvider.create({
      data: {
        id,
        kind: PROVIDER_KIND,
        label: 'DeepSeek real (experimento T3b)',
        baseUrl: 'https://api.deepseek.com',
        apiKeyCipher: cifrar(apiKey(), id),
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
        priceInputPerMToken: 0.15,
        priceOutputPerMToken: 0.6,
        priceCachedInputPerMToken: 0.003,
        priceOffPeakFactor: 0.5,
      },
    });
  }
  return model.id;
}

async function main(): Promise<void> {
  const userId = await asegurarDocenteDePrueba();
  const modelId = await asegurarProveedorDeepSeekReal();

  // T6: `AppSettings.fragmentEditsEnabled` ya no existe (ver el comentario
  // HISTORICAL ARTIFACT más arriba) — esta prueba genera un recurso NUEVO,
  // que nunca ofreció `edit_resource_code` ni con el interruptor viejo ni
  // con el camino actual, así que no hace falta tocar ningún ajuste acá.

  const htmlChico =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="kodu-tema" content="cuaderno"><title>Prueba</title></head>' +
    '<body>\n  <h1>Hola</h1>\n</body></html>';

  const project = await createProject({ userId, title: 'T3b — prueba barata', html: htmlChico });
  await prisma.project.update({ where: { id: project.id }, data: { aiModelId: modelId } });
  const threadId = project.threads[0]!.id;

  const loginResp = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DOCENTE_EMAIL, password: DOCENTE_PASSWORD }),
  });
  if (!loginResp.ok) throw new Error(`login falló: ${loginResp.status} ${await loginResp.text()}`);
  const cookie = loginResp.headers.get('set-cookie')!.split(';')[0]!;

  console.log('Mandando un ajuste chico contra DeepSeek real…');
  const resp = await fetch(`${BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ projectId: project.id, threadId, message: 'Cambiá "Hola" por "Chau"', model: modelId }),
  });
  if (!resp.ok) throw new Error(`/api/chat/stream: HTTP ${resp.status} ${await resp.text()}`);

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const tipos: string[] = [];
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
        tipos.push((JSON.parse(data) as { type: string }).type);
      } catch {
        /* keepalive */
      }
    }
  }
  console.log('Eventos SSE:', tipos.join(', '));

  const proyectoFinal = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
  console.log('HTML final incluye "Chau":', proyectoFinal.currentHtml.includes('Chau'));

  const usage = await prisma.tokenUsage.findFirst({ where: { projectId: project.id }, orderBy: { createdAt: 'desc' } });
  console.log('TokenUsage:', {
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
    cachedInputTokens: usage?.cachedInputTokens,
    costUsd: usage?.costUsd?.toString(),
    editMode: usage?.editMode,
  });

  await prisma.project.delete({ where: { id: project.id } }).catch(() => {});
}

await main();
await prisma.$disconnect();
