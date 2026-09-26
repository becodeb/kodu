/**
 * Orígenes de CDN permitidos para lo que carga un recurso de KoduEdu.
 *
 * Vive en su propio módulo (y no adentro de `src/pages/p/[slug].ts`, que es
 * donde se usa hoy) para que un futuro segundo consumidor de la misma lista
 * no tenga que duplicarla.
 *
 * Son orígenes (protocolo + host, sin ruta): comparar por origen exacto
 * (`new URL(url).origin`) y no por "empieza con" evita que un host similar
 * pero ajeno (`https://cdn.jsdelivr.net.evil.com`) cuele como permitido.
 */
export const ALLOWED_CDNS: readonly string[] = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];
