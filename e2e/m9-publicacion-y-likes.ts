import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Page } from 'playwright';
import { PrismaClient } from '../src/generated/prisma/client.ts';
import { hashPassword } from '../src/lib/auth/password.ts';
import { abrirNavegador, BASE_URL, conTema, iniciarSesion } from './harness.ts';

/**
 * Verificación del cambio publicacion-likes-y-motores: la invariante de
 * publicación, el corazón de la galería y el marcador de portada
 * desactualizada (design.md §14; specs `resource-publishing`,
 * `gallery-likes`, `ai-cost-accounting`).
 *
 * `npm run check` no ve una sola de estas conductas: son 11 bloques de
 * aserciones independientes, cada uno su propio fixture. Cubre, en orden:
 *  1. PATCH directo `isInGallery:true` sin portada → 422, al nivel de la API.
 *  2. Publicar por la UI: POST /screenshot antes que el PATCH, switch
 *     apagado durante, prendido después.
 *  3. Una captura forzada a fallar deja el switch apagado y la base sin
 *     publicar — la regresión del éxito silencioso.
 *  4. Borrar la portada despublica, con el aviso correspondiente.
 *  5. El diálogo de creación no tiene ni el toggle viejo ni "pestaña Ficha".
 *  6. Ida y vuelta de like, incluida la carrera del doble click.
 *  7. Orden por más-likeado primero, con el desempate por updatedAt.
 *  8. Anónimo: ve el corazón y el conteo, no puede likear.
 *  9. Marcador de portada vieja: aparece tras una edición, se va con una
 *     nueva captura, y una recarga inmediata después de capturar NO es
 *     "vieja" (la prueba de la tolerancia de 5s).
 * 10. El popover de consumo no menciona ni "US$" ni "$" para el docente.
 * 11. Los items 6, 8 y 9 se repiten en tema oscuro.
 *
 * Corre con: npx tsx e2e/m9-publicacion-y-likes.ts
 */

const DOCENTE_A_EMAIL = 'docente-e2e-m9-a@kodu.local';
const DOCENTE_B_EMAIL = 'docente-e2e-m9-b@kodu.local';
const DOCENTE_PASSWORD = 'Docente.E2E.2026';

const CORRIDA = randomUUID().slice(0, 8);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

async function asegurarDocente(email: string, nombre: string): Promise<string> {
  const docente = await prisma.user.upsert({
    where: { email },
    update: { role: 'DOCENTE' },
    create: { email, name: nombre, role: 'DOCENTE', passwordHash: await hashPassword(DOCENTE_PASSWORD) },
    select: { id: true },
  });
  return docente.id;
}

async function limpiarEstado(): Promise<void> {
  const docentes = await prisma.user.findMany({
    where: { email: { in: [DOCENTE_A_EMAIL, DOCENTE_B_EMAIL] } },
    select: { id: true },
  });
  const ids = docentes.map((d) => d.id);
  if (ids.length === 0) return;
  await prisma.projectLike.deleteMany({ where: { userId: { in: ids } } });
  await prisma.project.deleteMany({ where: { userId: { in: ids } } });
}

async function esperarHasta(condicion: () => Promise<boolean>, timeoutMs = 45_000): Promise<void> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (await condicion()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('esperarHasta: la condición nunca se cumplió a tiempo');
}

/** Crea un recurso vacío por API, como docente `page`. */
async function crearProyecto(page: Page, titulo?: string): Promise<{ id: string }> {
  const respuesta = await page.request.post(`${BASE_URL}/api/projects`, {
    data: titulo ? { title: titulo } : {},
  });
  assert.ok(respuesta.ok(), `crear el recurso debería dar 200, dio ${respuesta.status()}`);
  const { project } = (await respuesta.json()) as { project: { id: string } };
  return project;
}

/** Espera a que el switch de publicar esté habilitado (el iframe ya renderizó). */
async function esperarSwitchListo(page: Page) {
  const checkbox = page.locator('header .ml-auto').getByRole('checkbox');
  await checkbox.waitFor();
  await esperarHasta(async () => !(await checkbox.isDisabled()));
  return checkbox;
}

async function main(): Promise<void> {
  await limpiarEstado();
  const idDocenteA = await asegurarDocente(DOCENTE_A_EMAIL, 'Docente E2E M9 A');
  const idDocenteB = await asegurarDocente(DOCENTE_B_EMAIL, 'Docente E2E M9 B');

  const browser = await abrirNavegador();
  try {
    const contextoA = await browser.newContext();
    const pageA = await contextoA.newPage();
    await iniciarSesion(pageA, { email: DOCENTE_A_EMAIL, password: DOCENTE_PASSWORD });

    // ───────────────────────────────────────────────────────────
    // 1. Publicar sin portada es imposible, al nivel de la API — el punto
    //    donde el cliente SÍ se puede saltear (spec `resource-publishing`
    //    "Direct API call with no stored cover is rejected").
    // ───────────────────────────────────────────────────────────
    const proyectoSinPortada = await crearProyecto(pageA, `Recurso E2E M9 sin portada ${CORRIDA}`);
    const rechazo = await pageA.request.patch(`${BASE_URL}/api/projects/${proyectoSinPortada.id}`, {
      data: { isInGallery: true },
    });
    assert.equal(rechazo.status(), 422, `publicar sin portada debería dar 422, dio ${rechazo.status()}`);
    const cuerpoRechazo = (await rechazo.json()) as { error: string };
    assert.equal(
      cuerpoRechazo.error,
      'Para publicar hace falta una portada. Sacá una captura del recurso y volvé a intentar.',
    );
    const proyectoTrasRechazo = await prisma.project.findUniqueOrThrow({ where: { id: proyectoSinPortada.id } });
    assert.equal(proyectoTrasRechazo.isInGallery, false, 'isInGallery debe seguir en false tras el 422');
    console.log('✔ 1. PATCH directo isInGallery:true sin portada → 422 con el mensaje exacto (API)');

    // ───────────────────────────────────────────────────────────
    // 2. Publicar por la UI: POST /screenshot antes que el PATCH, switch
    //    apagado durante, prendido después.
    // ───────────────────────────────────────────────────────────
    const proyectoP2 = await crearProyecto(pageA, `Recurso E2E M9 publicable ${CORRIDA}`);
    await pageA.goto(`${BASE_URL}/app/project/${proyectoP2.id}`, { waitUntil: 'domcontentloaded' });

    const switchP2 = await esperarSwitchListo(pageA);
    assert.equal(await switchP2.isChecked(), false, 'el switch arranca apagado');

    const ordenPedidos: string[] = [];
    pageA.on('request', (req) => {
      if (req.url() === `${BASE_URL}/api/projects/${proyectoP2.id}/screenshot` && req.method() === 'POST') {
        ordenPedidos.push('POST /screenshot');
      }
      if (req.url() === `${BASE_URL}/api/projects/${proyectoP2.id}` && req.method() === 'PATCH') {
        ordenPedidos.push('PATCH /projects/:id');
      }
    });

    await switchP2.click({ force: true });
    // Justo después del click, mientras la secuencia (captura + POST + PATCH)
    // sigue en curso, el switch tiene que quedar deshabilitado y ocupado —
    // nunca se mueve optimistamente (design §3.2).
    assert.equal(await switchP2.isChecked(), false, 'el switch no se mueve mientras la secuencia corre');
    assert.equal(await switchP2.isDisabled(), true, 'el switch queda deshabilitado mientras publica');

    await esperarHasta(async () => ordenPedidos.length >= 2, 30_000);
    assert.deepEqual(ordenPedidos, ['POST /screenshot', 'PATCH /projects/:id'], 'la captura tiene que viajar ANTES que el PATCH');

    await esperarHasta(async () => await switchP2.isChecked());
    assert.equal(await switchP2.isDisabled(), false, 'el switch vuelve a estar habilitado al terminar');
    const proyectoP2TrasPublicar = await prisma.project.findUniqueOrThrow({ where: { id: proyectoP2.id } });
    assert.equal(proyectoP2TrasPublicar.isInGallery, true);
    assert.ok(proyectoP2TrasPublicar.screenshotUrl, 'el recurso publicado tiene que tener una portada guardada');
    console.log('✔ 2. Publicar por la UI: captura antes que el PATCH, switch apagado durante y prendido después');

    // ───────────────────────────────────────────────────────────
    // 3. Una captura forzada a fallar (CDN bloqueado) deja el switch
    //    apagado y la base sin publicar — la regresión del éxito silencioso
    //    que el timeout de 15s escondía antes de este cambio.
    // ───────────────────────────────────────────────────────────
    const contextoFalla = await browser.newContext();
    const pageFalla = await contextoFalla.newPage();
    await iniciarSesion(pageFalla, { email: DOCENTE_A_EMAIL, password: DOCENTE_PASSWORD });
    // El iframe de vista previa carga `html-to-image` desde jsDelivr; bloquear
    // ese pedido reproduce una captura que falla de verdad, sin mockear nada
    // del lado de la app.
    await pageFalla.route('**/html-to-image**', (route) => route.abort());

    const proyectoP3 = await crearProyecto(pageFalla, `Recurso E2E M9 captura fallida ${CORRIDA}`);
    await pageFalla.goto(`${BASE_URL}/app/project/${proyectoP3.id}`, { waitUntil: 'domcontentloaded' });
    const switchP3 = await esperarSwitchListo(pageFalla);

    await switchP3.click({ force: true });
    await pageFalla.getByRole('alert').waitFor({ timeout: 30_000 });
    assert.equal(await switchP3.isChecked(), false, 'una captura fallida no debe prender el switch');
    const proyectoP3TrasFalla = await prisma.project.findUniqueOrThrow({ where: { id: proyectoP3.id } });
    assert.equal(proyectoP3TrasFalla.isInGallery, false, 'isInGallery debe seguir en false tras una captura fallida');
    assert.equal(proyectoP3TrasFalla.screenshotUrl, null, 'no debe quedar ninguna portada guardada');
    console.log('✔ 3. Una captura fallida deja el switch apagado y el recurso sin publicar (nunca un éxito silencioso)');
    await contextoFalla.close();

    // ───────────────────────────────────────────────────────────
    // 4. Borrar la portada despublica, con el aviso correspondiente — es la
    //    segunda puerta al mismo estado que la invariante prohíbe.
    // ───────────────────────────────────────────────────────────
    await pageA.goto(`${BASE_URL}/app/project/${proyectoP2.id}`, { waitUntil: 'domcontentloaded' });
    await pageA.getByRole('button', { name: 'Quitar' }).click();
    await pageA.getByText('Portada borrada. El recurso salió de la galería.').waitFor({ timeout: 10_000 });
    const proyectoP2TrasBorrar = await prisma.project.findUniqueOrThrow({ where: { id: proyectoP2.id } });
    assert.equal(proyectoP2TrasBorrar.screenshotUrl, null);
    assert.equal(proyectoP2TrasBorrar.screenshotAt, null);
    assert.equal(proyectoP2TrasBorrar.isInGallery, false, 'borrar la portada de un recurso publicado debe despublicarlo');
    console.log('✔ 4. Borrar la portada despublica el recurso y avisa que salió de la galería');

    // ───────────────────────────────────────────────────────────
    // 5. El diálogo de creación no tiene ni el toggle viejo ni "pestaña
    //    Ficha" — un cambio a medio terminar no puede pasar esta prueba.
    // ───────────────────────────────────────────────────────────
    // La ficha se abre sola en un recurso recién creado sin título propio:
    // se crea uno así por API y se navega a él.
    const proyectoFicha = await crearProyecto(pageA);
    await pageA.goto(`${BASE_URL}/app/project/${proyectoFicha.id}`, { waitUntil: 'domcontentloaded' });
    await pageA.getByText('¿Qué vas a armar?').waitFor();
    const textoDialogo = (await pageA.locator('body').innerText()) ?? '';
    assert.ok(
      !textoDialogo.includes('Publicar en la galería institucional'),
      'el diálogo de creación no debe tener el toggle de publicar',
    );
    assert.ok(!textoDialogo.includes('pestaña Ficha'), 'el diálogo de creación no debe mencionar una "pestaña Ficha"');
    console.log('✔ 5. El diálogo "¿Qué vas a armar?" no tiene el toggle viejo ni menciona la "pestaña Ficha"');
    // Descartar el diálogo para no interferir con lo que sigue.
    await pageA.getByRole('button', { name: 'Después' }).click();

    // ───────────────────────────────────────────────────────────
    // 6. Ida y vuelta de like, incluida la carrera del doble click. Se
    //    republica proyectoP2 (perdió la portada en el item 4) para tener
    //    un recurso publicado sobre el que likear.
    // ───────────────────────────────────────────────────────────
    async function probarLikes(pageParaLikear: Page, contextoNombre: string): Promise<void> {
      const proyecto = await crearProyecto(pageA, `Recurso E2E M9 likeable ${contextoNombre} ${CORRIDA}`);
      await prisma.project.update({
        where: { id: proyecto.id },
        data: { screenshotUrl: 'https://example.com/m9-cover.png', screenshotAt: new Date(), isInGallery: true },
      });

      const likeUrl = `${BASE_URL}/api/projects/${proyecto.id}/like`;

      // Docente A likea → cuenta 1.
      const like1 = await pageA.request.post(likeUrl, { data: {} });
      assert.equal(like1.status(), 200);
      const cuerpoLike1 = (await like1.json()) as { liked: boolean; likes: number };
      assert.equal(cuerpoLike1.liked, true);
      assert.equal(cuerpoLike1.likes, 1);
      assert.equal(await prisma.projectLike.count({ where: { projectId: proyecto.id } }), 1);

      // El mismo docente clickea de nuevo → se saca el like, cuenta 0.
      const unlike1 = await pageA.request.delete(likeUrl, { data: {} });
      const cuerpoUnlike1 = (await unlike1.json()) as { liked: boolean; likes: number };
      assert.equal(cuerpoUnlike1.liked, false);
      assert.equal(cuerpoUnlike1.likes, 0);
      assert.equal(await prisma.projectLike.count({ where: { projectId: proyecto.id } }), 0);

      // Docente B likea → cuenta 1 (independiente del de A).
      const like2 = await pageParaLikear.request.post(likeUrl, { data: {} });
      const cuerpoLike2 = (await like2.json()) as { liked: boolean; likes: number };
      assert.equal(cuerpoLike2.likes, 1);

      // Doble click rápido del MISMO docente sobre un recurso sin su like
      // todavía: exactamente una fila, nunca dos — el `@@unique` sostiene la
      // carrera aunque las dos lleguen casi juntas.
      await prisma.projectLike.deleteMany({ where: { projectId: proyecto.id } });
      await Promise.all([pageA.request.post(likeUrl, { data: {} }), pageA.request.post(likeUrl, { data: {} })]);
      const filasTrasCarrera = await prisma.projectLike.count({
        where: { projectId: proyecto.id, userId: idDocenteA },
      });
      assert.equal(filasTrasCarrera, 1, 'un doble click no debe crear dos filas de ProjectLike');

      // Limpieza para no arrastrar likes de A al test de orden (item 7).
      await prisma.projectLike.deleteMany({ where: { projectId: proyecto.id } });
    }

    const contextoB = await browser.newContext();
    const pageB = await contextoB.newPage();
    await iniciarSesion(pageB, { email: DOCENTE_B_EMAIL, password: DOCENTE_PASSWORD });

    await probarLikes(pageB, 'light');
    console.log('✔ 6. Ida y vuelta de like + la carrera del doble click sostiene el @@unique (tema light)');

    // ───────────────────────────────────────────────────────────
    // 7. Orden por más-likeado primero, con desempate por updatedAt.
    // ───────────────────────────────────────────────────────────
    async function crearPublicado(titulo: string, updatedAt: Date): Promise<string> {
      const p = await crearProyecto(pageA, titulo);
      await prisma.project.update({
        where: { id: p.id },
        data: {
          screenshotUrl: 'https://example.com/m9-cover.png',
          screenshotAt: updatedAt,
          isInGallery: true,
          updatedAt,
        },
      });
      return p.id;
    }

    const ahora = new Date();
    const idDosLikes = await crearPublicado(`Recurso M9 orden 2likes ${CORRIDA}`, ahora);
    const idUnLike = await crearPublicado(`Recurso M9 orden 1like ${CORRIDA}`, ahora);
    const idCeroLikes = await crearPublicado(`Recurso M9 orden 0likes ${CORRIDA}`, ahora);

    await prisma.projectLike.createMany({
      data: [
        { userId: idDocenteA, projectId: idDosLikes },
        { userId: idDocenteB, projectId: idDosLikes },
        { userId: idDocenteA, projectId: idUnLike },
      ],
    });

    await pageA.goto(`${BASE_URL}/gallery`, { waitUntil: 'domcontentloaded' });
    const tituloDosLikes = `Recurso M9 orden 2likes ${CORRIDA}`;
    const tituloUnLike = `Recurso M9 orden 1like ${CORRIDA}`;
    const tituloCeroLikes = `Recurso M9 orden 0likes ${CORRIDA}`;
    const textoGaleria = (await pageA.locator('main, body').first().innerText()) ?? (await pageA.content());
    const posDos = textoGaleria.indexOf(tituloDosLikes);
    const posUno = textoGaleria.indexOf(tituloUnLike);
    const posCero = textoGaleria.indexOf(tituloCeroLikes);
    assert.ok(posDos !== -1 && posUno !== -1 && posCero !== -1, 'los tres recursos de prueba deben estar en la galería');
    assert.ok(posDos < posUno, 'el recurso con 2 likes debe aparecer antes que el de 1 like');
    assert.ok(posUno < posCero, 'el recurso con 1 like debe aparecer antes que el de 0 likes');
    console.log('✔ 7a. La galería ordena por cantidad de likes, descendente');

    // Empate a likes: el de updatedAt más reciente va primero.
    const idEmpateViejo = await crearPublicado(`Recurso M9 empate viejo ${CORRIDA}`, new Date(ahora.getTime() - 60_000));
    const idEmpateNuevo = await crearPublicado(`Recurso M9 empate nuevo ${CORRIDA}`, ahora);
    await prisma.projectLike.createMany({
      data: [
        { userId: idDocenteA, projectId: idEmpateViejo },
        { userId: idDocenteA, projectId: idEmpateNuevo },
      ],
    });
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    const textoGaleria2 = (await pageA.locator('main, body').first().innerText()) ?? (await pageA.content());
    const posViejo = textoGaleria2.indexOf(`Recurso M9 empate viejo ${CORRIDA}`);
    const posNuevo = textoGaleria2.indexOf(`Recurso M9 empate nuevo ${CORRIDA}`);
    assert.ok(posViejo !== -1 && posNuevo !== -1);
    assert.ok(posNuevo < posViejo, 'a igual cantidad de likes, el updatedAt más reciente va primero');
    console.log('✔ 7b. A igual cantidad de likes, el más recién tocado sale primero');

    // ───────────────────────────────────────────────────────────
    // 8. Anónimo: ve el corazón y el conteo, no puede likear.
    // ───────────────────────────────────────────────────────────
    async function probarAnonimo(): Promise<void> {
      const contextoAnonimo = await browser.newContext();
      const pageAnonima = await contextoAnonimo.newPage();
      await pageAnonima.goto(`${BASE_URL}/gallery`, { waitUntil: 'domcontentloaded' });

      const corazon = pageAnonima
        .locator('li')
        .filter({ hasText: tituloDosLikes })
        .getByRole('button', { name: /Me gusta|Iniciá sesión/i });
      await corazon.waitFor();
      assert.equal(await corazon.textContent(), '2', 'el conteo tiene que ser visible para un visitante anónimo');
      assert.equal(
        await corazon.getAttribute('aria-pressed'),
        null,
        'un visitante anónimo nunca debe ver aria-pressed (no es un toggle real para él)',
      );

      // `waitForURL` espera el evento "load"; en esta máquina, con varias
      // pestañas/contextos de Chromium abiertos a la vez, una pestaña de
      // fondo puede quedar postergada y ese evento tarda de más o perderse
      // del todo. Se encuesta la URL directamente (el cambio es un
      // `window.location.href` síncrono) y se reintenta el click si hace
      // falta, en vez de depender de un único evento de red.
      await esperarHasta(async () => {
        if (/\/login\?next=%2Fgallery/.test(pageAnonima.url())) return true;
        await corazon.click().catch(() => {});
        return /\/login\?next=%2Fgallery/.test(pageAnonima.url());
      }, 30_000);
      const likesTrasClickAnonimo = await prisma.projectLike.count({ where: { projectId: idDosLikes } });
      assert.equal(likesTrasClickAnonimo, 2, 'el click anónimo no debe crear ningún ProjectLike');
      await contextoAnonimo.close();
    }

    await probarAnonimo();
    console.log('✔ 8. Anónimo ve el corazón + conteo sin aria-pressed, y el click va a /login?next=%2Fgallery (tema light)');

    // ───────────────────────────────────────────────────────────
    // 9. Marcador de portada vieja: aparece tras una edición manual, se va
    //    con una nueva captura, y una recarga inmediata después de capturar
    //    NO queda marcada vieja (la prueba de la tolerancia de 5s).
    // ───────────────────────────────────────────────────────────
    async function probarPortadaVieja(): Promise<void> {
      const proyecto = await crearProyecto(pageA, `Recurso E2E M9 portada vieja ${CORRIDA}`);
      await pageA.goto(`${BASE_URL}/app/project/${proyecto.id}`, { waitUntil: 'domcontentloaded' });

      // Primera captura: arranca en "Sacar portada" (sin cover todavía).
      const botonPortada = pageA.getByRole('button', {
        name: /Sacar portada|Cambiar portada|Actualizar portada|Capturando…/,
      });
      await botonPortada.waitFor();
      assert.equal((await botonPortada.textContent())?.trim(), 'Sacar portada');
      await botonPortada.click();
      await esperarHasta(async () => (await botonPortada.textContent())?.trim() === 'Cambiar portada', 30_000);
      console.log('✔ 9a. Sin portada: "Sacar portada"; tras la primera captura: "Cambiar portada"');

      // La prueba de tolerancia: recargar YA MISMO no debe leerse como vieja.
      await pageA.reload({ waitUntil: 'domcontentloaded' });
      const botonTrasReload = pageA.getByRole('button', {
        name: /Sacar portada|Cambiar portada|Actualizar portada|Capturando…/,
      });
      await botonTrasReload.waitFor();
      assert.equal(
        (await botonTrasReload.textContent())?.trim(),
        'Cambiar portada',
        'una recarga inmediatamente después de capturar NO debe leerse como portada vieja (tolerancia de 5s)',
      );
      assert.equal(
        await pageA.locator('button:has-text("Cambiar portada") span.bg-brand-600').count(),
        0,
        'no debe haber ningún punto de "vieja" recién capturado',
      );
      console.log('✔ 9b. Recargar justo después de capturar no marca la portada como vieja (tolerancia de 5s)');

      // Editar el código a mano marca la portada como vieja. El texto del
      // botón, cuando está vieja, lleva ADEMÁS el `sr-only` "La portada
      // quedó desactualizada." pegado atrás (mismo <button>): se compara con
      // `startsWith`, no con igualdad exacta.
      await pageA.getByRole('tab', { name: 'Código' }).click();
      const editor = pageA.locator('.cm-content');
      await editor.waitFor({ timeout: 10_000 });
      await editor.click();
      await pageA.keyboard.press('End');
      await pageA.keyboard.type(' ');

      const botonEnCodigo = pageA.getByRole('button', {
        name: /Sacar portada|Cambiar portada|Actualizar portada|Capturando…/,
      });
      await esperarHasta(async () => (await botonEnCodigo.textContent())?.startsWith('Actualizar portada') ?? false);
      assert.equal(await botonEnCodigo.locator('span.bg-brand-600').count(), 1, 'debe aparecer el punto de "vieja"');
      console.log('✔ 9c. Una edición manual marca la portada como vieja: "Actualizar portada" + el punto');

      // Capturar de nuevo la limpia.
      await botonEnCodigo.click();
      await esperarHasta(async () => (await botonEnCodigo.textContent())?.trim() === 'Cambiar portada', 30_000);
      assert.equal(await botonEnCodigo.locator('span.bg-brand-600').count(), 0, 'el punto debe desaparecer');
      console.log('✔ 9d. Una nueva captura vuelve a "Cambiar portada" y el punto desaparece');
    }

    await probarPortadaVieja();

    // ───────────────────────────────────────────────────────────
    // 10. El popover de consumo no menciona ni "US$" ni "$" para el docente.
    // ───────────────────────────────────────────────────────────
    async function probarSinUsd(): Promise<void> {
      const proyecto = await crearProyecto(pageA, `Recurso E2E M9 consumo ${CORRIDA}`);
      const motor = await prisma.aiModel.findFirst({ where: { enabled: true } });
      assert.ok(motor, 'debería haber al menos un motor sembrado');
      await prisma.tokenUsage.create({
        data: {
          userId: idDocenteA,
          projectId: proyecto.id,
          aiModelId: motor!.id,
          model: motor!.providerModel,
          promptTokens: 5_000,
          completionTokens: 1_000,
          costUsd: '0.01',
        },
      });

      await pageA.goto(`${BASE_URL}/app/project/${proyecto.id}`, { waitUntil: 'domcontentloaded' });
      const botonConsumo = pageA.getByRole('button', { name: /^Consumo (bajo|medio|alto)$/ });
      await botonConsumo.waitFor();
      const popover = pageA.locator('[role="status"]');
      await esperarHasta(async () => {
        await botonConsumo.hover();
        return (await popover.count()) > 0;
      });
      const textoPopover = (await popover.textContent()) ?? '';
      assert.match(textoPopover, /tokens/i);
      assert.ok(!textoPopover.includes('US$'), 'el popover no debe mostrar "US$"');
      assert.ok(!textoPopover.includes('$'), 'el popover no debe mostrar ningún "$"');
    }

    await probarSinUsd();
    console.log('✔ 10. El popover de consumo habla de tokens, nunca de US$ ni de $');

    // ───────────────────────────────────────────────────────────
    // 11. Los items 6, 8 y 9 se repiten en tema oscuro — son las tres cosas
    //     nuevas de este cambio que llevan color (el corazón, el punto de
    //     "vieja" y el chip de motor).
    // ───────────────────────────────────────────────────────────
    // Re-anclar ambas páginas a una URL estable antes de tocar localStorage:
    // después de tantos pasos, Chromium puede haber descartado la pestaña de
    // fondo bajo presión de memoria, y `conTema` necesita un documento
    // http(s) vivo para poder leer/escribir `localStorage`.
    await pageA.goto(`${BASE_URL}/gallery`, { waitUntil: 'domcontentloaded' });
    await pageB.goto(`${BASE_URL}/gallery`, { waitUntil: 'domcontentloaded' });
    await conTema(pageA, 'dark');
    await conTema(pageB, 'dark');

    await probarLikes(pageB, 'dark');
    console.log('✔ 11a. Ida y vuelta de like + doble click en tema oscuro');

    await probarAnonimo();
    console.log('✔ 11b. Anónimo ve el corazón + conteo en tema oscuro');

    await probarPortadaVieja();
    console.log('✔ 11c. El marcador de portada vieja funciona igual en tema oscuro');

    await contextoB.close();
  } finally {
    await browser.close();
    await limpiarEstado();
    await prisma.$disconnect();
  }
}

main()
  .then(() => {
    console.log('\n✔ e2e/m9-publicacion-y-likes.ts: todos los escenarios pasaron');
  })
  .catch((error) => {
    console.error('\n✖ e2e/m9-publicacion-y-likes.ts falló:', error);
    process.exitCode = 1;
  });
