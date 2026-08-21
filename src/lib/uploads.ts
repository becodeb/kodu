import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getEnv } from './env.ts';
import { uniqueFilename } from './slug.ts';

/**
 * Almacenamiento de archivos en disco (SPEC §2 y §6).
 *
 * Van a `UPLOADS_DIR` (por defecto ./uploads, en Docker el volumen persistente
 * /app/uploads) y NO a `public/`: en modo SSR standalone Astro sirve la copia de
 * `public/` congelada en el build, así que lo que se escriba en runtime no
 * aparecería. Por eso existe la ruta /uploads/[...path].ts.
 */

export type UploadKind = 'assets' | 'screenshots';

export const IMAGE_MIMES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};

export const PDF_MIMES: Record<string, string> = {
  'application/pdf': 'pdf',
};

const EXTENSION_MIMES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
};

export function uploadsRoot(): string {
  return path.resolve(getEnv().UPLOADS_DIR);
}

export function maxUploadBytes(): number {
  return getEnv().MAX_UPLOAD_MB * 1024 * 1024;
}

export interface StoredFile {
  filename: string;
  /** URL pública servida por /uploads/[...path].ts */
  url: string;
  absolutePath: string;
}

export async function storeFile(
  kind: UploadKind,
  data: Buffer | Uint8Array,
  extension: string,
): Promise<StoredFile> {
  const directory = path.join(uploadsRoot(), kind);
  await mkdir(directory, { recursive: true });

  const filename = uniqueFilename(extension);
  const absolutePath = path.join(directory, filename);
  await writeFile(absolutePath, data);

  return { filename, url: `/uploads/${kind}/${filename}`, absolutePath };
}

/**
 * Traduce una ruta pedida por HTTP a una ruta en disco, o null si intenta
 * escaparse del directorio de uploads (`../../etc/passwd` y variantes).
 */
export function resolveStoredPath(relativePath: string): string | null {
  const root = uploadsRoot();
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '');
  const target = path.resolve(root, normalized);

  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!target.startsWith(rootWithSep)) return null;

  return target;
}

export function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  return EXTENSION_MIMES[extension] ?? 'application/octet-stream';
}

export async function readStoredFile(absolutePath: string): Promise<Buffer | null> {
  try {
    return await readFile(absolutePath);
  } catch {
    return null;
  }
}

/**
 * Extrae el texto de un PDF para inyectarlo como contexto de la IA (SPEC §4.2).
 * Si falla, devolvemos null y el archivo se guarda igual: perder el texto no
 * puede tumbar la subida.
 */
export async function extractPdfText(data: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const pdf = await getDocumentProxy(new Uint8Array(data));
    const { text } = await extractText(pdf, { mergePages: true });

    const merged = Array.isArray(text) ? text.join('\n') : text;
    const clean = merged.replace(/\s+\n/g, '\n').trim();

    return clean.length > 0 ? clean : null;
  } catch (error) {
    console.error('[uploads] no se pudo extraer texto del PDF:', error);
    return null;
  }
}

/** Decodifica un data URL de captura (`data:image/webp;base64,…`). */
export function decodeDataUrl(dataUrl: string): { data: Buffer; extension: string } | null {
  const match = /^data:(image\/(?:png|webp|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) return null;

  const extension = IMAGE_MIMES[match[1]!];
  if (!extension) return null;

  const data = Buffer.from(match[2]!, 'base64');
  if (data.byteLength === 0 || data.byteLength > maxUploadBytes()) return null;

  return { data, extension };
}
