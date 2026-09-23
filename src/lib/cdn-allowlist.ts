/**
 * Orígenes de CDN permitidos para lo que carga un recurso de KoduEdu.
 *
 * Antes vivía sólo en `src/pages/p/[slug].ts` (la CSP de la vista pública).
 * T7 (odd/tasks/modo-prime.md, "Revisión automática") necesita la MISMA
 * lista para avisar en el editor — antes de publicar — lo que la CSP recién
 * iba a bloquear: un módulo compartido evita que las dos listas se
 * desincronicen con el tiempo (un admin agrega un CDN a una y se olvida de
 * la otra, y la revisión automática deja de avisar algo que en realidad se
 * rompe, o al revés).
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
