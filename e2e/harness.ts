import { chromium, type Page } from 'playwright';

/**
 * Arnés compartido por todos los e2e/<slice>.ts de este cambio.
 *
 * No hay test runner en el repo (ver openspec/context.md): estos scripts se
 * corren con `npx tsx e2e/<slice>.ts` y salen con código de error cuando algo
 * falla. Los navegadores de Playwright no están descargados; se usa el
 * Chromium del sistema.
 */

export const BASE_URL = process.env.KODU_BASE_URL ?? 'http://localhost:3000';

export const abrirNavegador = () =>
  chromium.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--disable-gpu', '--no-sandbox'],
  });

/** Cambia el tema guardado en localStorage y recarga, como hace el usuario real. */
export async function conTema(page: Page, tema: 'light' | 'dark'): Promise<void> {
  await page.evaluate((valor) => localStorage.setItem('kodu-tema', valor), tema);
  await page.reload();
}

export interface Credenciales {
  email: string;
  password: string;
}

/**
 * Inicia sesión por API (sin pasar por el <form>) y deja la cookie cargada
 * en el contexto del navegador: `page.request` comparte el cookie jar con
 * `page`, así que cualquier `page.goto` posterior ya va autenticado.
 */
export async function iniciarSesion(page: Page, credenciales: Credenciales): Promise<void> {
  const respuesta = await page.request.post(`${BASE_URL}/api/auth/login`, {
    data: credenciales,
  });
  if (!respuesta.ok()) {
    throw new Error(
      `No se pudo iniciar sesión con ${credenciales.email} (${respuesta.status()}): ${await respuesta.text()}`,
    );
  }
}
