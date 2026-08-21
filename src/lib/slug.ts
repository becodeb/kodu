import { customAlphabet } from 'nanoid';

/** Alfabeto sin caracteres ambiguos: los slugs se dictan en voz alta en el aula. */
const shortId = customAlphabet('abcdefghijkmnopqrstuvwxyz23456789', 8);

export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // saca tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Slug público del recurso: legible + sufijo único (`fracciones-equivalentes-k3m9x2p7`). */
export function buildProjectSlug(title: string): string {
  const base = slugify(title) || 'recurso';
  return `${base}-${shortId()}`;
}

/** Nombre de archivo único para uploads. */
export function uniqueFilename(extension: string): string {
  return `${Date.now().toString(36)}-${shortId()}.${extension.replace(/^\./, '')}`;
}
