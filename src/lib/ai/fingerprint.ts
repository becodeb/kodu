/**
 * Huella determinística de un HTML (FNV-1a de 32 bits, en hex).
 *
 * Sirve para detectar cuándo `Project.currentHtml` ya no es el HTML que un
 * cliente tenía a mano al armar un pedido (el docente editó el código a mano
 * en el medio, o otra pestaña terminó un turno antes) — usada por
 * `/api/chat/verificar` y `/api/chat/autocorreccion`. No es criptográfica ni
 * hace falta que lo sea — no defiende contra alguien que intente
 * falsificarla, sólo detecta un cambio real; el servidor sigue siendo quien
 * manda.
 *
 * Isomórfico a propósito, como `kit.ts`: lo importa el servidor Y el cliente
 * (`Workspace.tsx`, para calcular la MISMA huella sobre el HTML que tiene a
 * mano antes de mandarla). Por eso no usa `Buffer` ni `TextEncoder`: son
 * aritmética pura sobre `charCodeAt`, para dar EXACTAMENTE el mismo valor en
 * Node y en el navegador.
 *
 * Movida acá desde un módulo que se sacó entero
 * (odd/tasks/generacion-simple-y-reanudable.md, T1), pero esta huella sigue
 * haciendo falta para otras dos features.
 */
export function fingerprintHtml(html: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
