import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '../env.ts';

/**
 * Cifrado de las API keys del catálogo (`AiProvider.apiKeyCipher`).
 *
 * AES-256-GCM porque autentica además de cifrar: si alguien pega el
 * ciphertext de una fila en otra, la falla de autenticación (el AAD no
 * coincide) es visible en vez de devolver basura silenciosa. Ver design.md §4.
 *
 * Formato guardado: "v1.<nonce>.<ciphertext>.<tag>", cada parte en
 * base64url. El prefijo de versión deja lugar a un "v2" (otra KDF, id de
 * clave) conviviendo con "v1" durante una rotación.
 */

const VERSION = 'v1';

/** No hay `KODU_ENCRYPTION_KEY` configurada, o no tiene el largo correcto. */
export class ClaveNoConfigurada extends Error {
  constructor(message = 'El servidor no tiene configurada la clave de cifrado.') {
    super(message);
    this.name = 'ClaveNoConfigurada';
  }
}

/**
 * La clave configurada no es la que cifró este dato (falla la autenticación
 * GCM), o el valor guardado está corrupto/manipulado. Se distingue de
 * `ClaveNoConfigurada` porque el diagnóstico es distinto: acá el problema no
 * es que falte la clave, es que la que hay está mal.
 */
export class ClaveInvalida extends Error {
  constructor(message = 'No se pudo descifrar: la clave no coincide o el dato está corrupto.') {
    super(message);
    this.name = 'ClaveInvalida';
  }
}

/**
 * Se valida acá adentro y no en el schema de `env.ts` a propósito: una
 * instancia recién instalada, sin un solo motor cargado, tiene que poder
 * arrancar igual. El error sólo aparece cuando alguien de verdad intenta
 * cifrar o descifrar algo.
 */
function claveDesdeHex(hex: string, nombre: string): Buffer {
  if (!hex) throw new ClaveNoConfigurada();

  const clave = Buffer.from(hex, 'hex');
  if (clave.length !== 32) {
    throw new ClaveNoConfigurada(`${nombre} debe ser de 32 bytes en hexadecimal (64 caracteres).`);
  }
  return clave;
}

function obtenerClave(): Buffer {
  return claveDesdeHex(getEnv().KODU_ENCRYPTION_KEY, 'KODU_ENCRYPTION_KEY');
}

function cifrarConClave(textoPlano: string, aad: string, clave: Buffer): string {
  const nonce = randomBytes(12);

  const cipher = createCipheriv('aes-256-gcm', clave, nonce);
  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(textoPlano, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, nonce.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join(
    '.',
  );
}

function descifrarConClave(valorGuardado: string, aad: string, clave: Buffer): string {
  const partes = valorGuardado.split('.');

  if (partes.length !== 4 || partes[0] !== VERSION) {
    throw new ClaveInvalida('El formato del valor cifrado no es reconocido.');
  }

  const [, nonceB64, ciphertextB64, tagB64] = partes as [string, string, string, string];

  try {
    const decipher = createDecipheriv('aes-256-gcm', clave, Buffer.from(nonceB64, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));

    const textoPlano = Buffer.concat([
      decipher.update(Buffer.from(ciphertextB64, 'base64url')),
      decipher.final(),
    ]);
    return textoPlano.toString('utf8');
  } catch {
    // `decipher.final()` tira cuando el auth tag no valida: clave equivocada
    // o AAD que no coincide. Nunca se loguea el ciphertext ni la clave acá.
    throw new ClaveInvalida();
  }
}

/**
 * Cifra `textoPlano` (la API key en claro) con `KODU_ENCRYPTION_KEY`.
 *
 * `aad` es el AAD (additional authenticated data): en este módulo siempre es
 * el `id` de la fila dueña del cifrado (`AiProvider` desde
 * catalogo-de-proveedores; antes era `AiModel`), generado por el caller ANTES
 * de cifrar (`crypto.randomUUID()`). Un ciphertext copiado a otra fila falla
 * al descifrar porque el AAD ya no coincide.
 */
export function cifrar(textoPlano: string, aad: string): string {
  return cifrarConClave(textoPlano, aad, obtenerClave());
}

/** Descifra un valor guardado con {@link cifrar}. `aad` debe ser el mismo `id`. */
export function descifrar(valorGuardado: string, aad: string): string {
  return descifrarConClave(valorGuardado, aad, obtenerClave());
}

/**
 * Variantes con la clave explícita en hex, para `scripts/rotar-clave.ts`: ahí
 * hace falta descifrar con la clave VIEJA y cifrar con la NUEVA en el mismo
 * proceso, y `KODU_ENCRYPTION_KEY` sólo puede valer una cosa a la vez.
 */
export function cifrarConClaveHex(textoPlano: string, aad: string, claveHex: string): string {
  return cifrarConClave(textoPlano, aad, claveDesdeHex(claveHex, 'La clave de cifrado'));
}

export function descifrarConClaveHex(valorGuardado: string, aad: string, claveHex: string): string {
  return descifrarConClave(valorGuardado, aad, claveDesdeHex(claveHex, 'La clave de cifrado'));
}

/** Los últimos 4 caracteres de la clave en claro, para reconocerla en el panel. */
export function pistaDeClave(textoPlano: string): string {
  return textoPlano.slice(-4);
}
