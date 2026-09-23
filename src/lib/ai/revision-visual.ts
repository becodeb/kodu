/**
 * Revisión visual con captura (T8, odd/tasks/modo-prime.md — "el modelo mira
 * una captura de su propio resultado"). Sólo la parte PURA: la política de
 * cuándo corresponde ofrecerla y la huella con la que el endpoint detecta si
 * el recurso cambió entre que el cliente capturó la imagen y que el pedido
 * llegó al servidor. La llamada al modelo, la persistencia y el descarte por
 * hallazgos nuevos viven en `src/pages/api/chat/visual-review.ts` — esto de
 * acá no toca Prisma, ni red, ni estado.
 *
 * Isomórfico a propósito, como `kit.ts` y `client/html-parcial.ts`: lo
 * importa el servidor (`stream.ts`, para decidir si corresponde; el
 * endpoint, para la huella) Y el cliente (`Workspace.tsx`, para calcular la
 * MISMA huella sobre el HTML que capturó, antes de mandarla). Por eso
 * `fingerprintHtml` no usa `Buffer` ni `TextEncoder`: son aritmética pura
 * sobre `charCodeAt`, para dar EXACTAMENTE el mismo valor en Node y en el
 * navegador.
 *
 * `validarImagenRevisionVisual`, al final del archivo, es la excepción: usa
 * `Buffer` porque sólo la llama el servidor (el cliente nunca valida su
 * propia captura, sólo la manda). Vive acá y no en `visual-review.ts` por lo
 * mismo que el resto de este módulo: sin ningún `import` de `env.ts`/`db.ts`
 * de por medio, se puede probar sin `.env` cargado — igual que kit.ts y
 * revision.ts (ver e2e/unidad-revision-visual.ts, "las tres partes puras de
 * T8"). Ese único uso de `Buffer` nunca corre en el navegador (nada del
 * cliente la importa), así que no rompe el resto del archivo.
 */

import type { Speed } from './provider.ts';

export interface DecisionRevisionVisual {
  /** La velocidad EFECTIVA de este turno (`resolverVelocidadEfectiva`,
   *  capacidades.ts). `null`/`'fast'` nunca ofrecen revisión visual. */
  velocidadEfectiva: Speed | null;
  /** `supportsVision(motor)` (provider.ts) del motor que produjo el HTML. */
  motorVeImagenes: boolean;
  /** Este turno cambió `Project.currentHtml` — mismo criterio que decide si
   *  stream.ts crea una instantánea para deshacer (T4). Sin cambio, no hay
   *  nada nuevo que mirar. */
  cambioElRecurso: boolean;
  /**
   * Hook para T9 ("Varias versiones al crear"): decisión de diseño
   * "Revisión visual y versiones son excluyentes" — con varias versiones no
   * corre la revisión visual (triplicaría costo y tiempo). T8 genera una
   * sola versión siempre, así que quien llama hoy manda `false`; T9 va a
   * mandar el valor real.
   */
  huboVariasVersiones: boolean;
}

/**
 * ¿Corresponde ofrecerle al cliente la revisión visual de ESTE turno? Pura:
 * la llama `stream.ts` al final del turno (dentro del `finally`, con lo que
 * ya sabe de esa vuelta) para decidir el flag que viaja en el evento "done"
 * — el cliente nunca decide esto solo (ver la tarea T8).
 */
export function aplicaRevisionVisual(decision: DecisionRevisionVisual): boolean {
  return (
    decision.velocidadEfectiva === 'deep' &&
    decision.motorVeImagenes &&
    decision.cambioElRecurso &&
    !decision.huboVariasVersiones
  );
}

/**
 * Huella determinística de un HTML (FNV-1a de 32 bits, en hex). Sirve para
 * UNA sola cosa: que `POST /api/chat/visual-review` pueda rechazar con 409
 * cuando `Project.currentHtml` ya no es el HTML que el cliente capturó (el
 * docente editó el código a mano en el medio, o otra pestaña terminó un
 * turno antes). No es criptográfica ni hace falta que lo sea — no defiende
 * contra alguien que intente falsificarla, sólo detecta un cambio real; el
 * servidor sigue siendo quien manda.
 */
export function fingerprintHtml(html: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) {
    hash ^= html.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * El único mensaje de usuario de la llamada de revisión visual (español,
 * voseo, mismo tono que BASE_PROMPT — prompt.ts). Server-only en la
 * práctica (sólo la usa el endpoint), pero vive acá con el resto de la
 * política de T8 para no repartir esta feature en más módulos de los que
 * hace falta.
 */
export const INSTRUCCION_REVISION_VISUAL = `Esta es una captura de cómo se ve el recurso ahora mismo, tal como lo está viendo el docente. Mirala como un diseñador exigente y fijate si hay problemas VISIBLES en la imagen:
- texto cortado, superpuesto o ilegible
- contraste bajo
- elementos desalineados o apretados
- zonas vacías grandes
- íconos que no se dibujaron
- algo que se ve roto o a medio terminar
- más texto del necesario

Si encontrás alguno, llamá a update_resource_code y corregí SOLO lo que hace falta para resolverlos, respetando el tema y la estructura del recurso (paleta, tipografía, disposición). No inventes contenido nuevo ni toques lo que ya está bien.

Si no encontrás ningún problema visible, respondé exactamente "Sin cambios." y no llames a la herramienta.`;

/** Tope propio, NO el de `uploads.ts` (`MAX_UPLOAD_MB`/`getEnv()`): esto es
 *  una captura interna ya acotada por el cliente (JPEG, alto tope ~1600px —
 *  ver `preview.ts`/`PreviewPanel.tsx`), no un archivo que suba el docente.
 *  No depender de `env.ts` acá es lo que permite probar el validador de
 *  abajo sin `.env` cargado. */
const TOPE_IMAGEN_BYTES = 6 * 1024 * 1024;

/**
 * Valida el data URL de la captura de revisión visual: sólo png/jpeg/webp,
 * y por debajo del tope de bytes. Duplica a propósito la FORMA de
 * `decodeDataUrl` (`lib/uploads.ts`) en vez de reusarla — ver el comentario
 * grande más arriba sobre por qué este módulo no importa `env.ts` (mismo
 * criterio que revision.ts documenta para `valorAtributo`, duplicada de
 * kit.ts: acoplar dos módulos por unas pocas líneas sale más caro que
 * repetirlas).
 */
export function validarImagenRevisionVisual(dataUrl: string): { data: Buffer; mime: string } | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;

  const data = Buffer.from(match[2]!, 'base64');
  if (data.byteLength === 0 || data.byteLength > TOPE_IMAGEN_BYTES) return null;

  return { data, mime: match[1]! };
}
