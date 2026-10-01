import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnv, isProduction } from '../../env.ts';
import { FacturadorSimulado } from './simulado.ts';
import { FacturadorArca, type ArcaConfig } from './arca.ts';
import type { Invoicer } from './tipos.ts';

export type { Invoicer } from './tipos.ts';
export * from './tipos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8): a qué adaptador de `Invoicer` le habla
 * el servidor, elegido por `INVOICE_PROVIDER`. `null` = "facturación
 * automática apagada en este entorno" — `crearFacturaPendiente` ya dejó la
 * factura en `PENDING`; el llamador NUNCA inventa un CAE (mismo criterio que
 * `pasarela/index.ts#resolverGatewayDePago` en T4).
 */
export function resolverFacturador(): Invoicer | null {
  const env = getEnv();

  if (env.INVOICE_PROVIDER === 'arca') {
    const config = resolverConfigArca();
    if (!config) return null;
    return new FacturadorArca(config);
  }

  if (env.INVOICE_PROVIDER === 'simulado') {
    if (isProduction()) return null; // nunca un CAE falso en producción.
    return new FacturadorSimulado();
  }

  return null; // 'none'
}

let certKeyPathsCache: { certPath: string; keyPath: string } | null = null;

/** Resuelve certificado y clave a rutas de archivo: si `ARCA_CERT_PATH`/
 *  `ARCA_KEY_PATH` están cargadas, se usan directo; si no, se decodifica el
 *  base64 UNA sola vez a un directorio temporal (cacheado para el resto del
 *  proceso — no tiene sentido rehacer el archivo en cada factura). */
function resolverConfigArca(): ArcaConfig | null {
  const env = getEnv();
  if (!env.ARCA_CUIT || !env.ARCA_PUNTO_VENTA) return null;

  let certPath = env.ARCA_CERT_PATH;
  let keyPath = env.ARCA_KEY_PATH;

  if (!certPath || !keyPath) {
    if (!env.ARCA_CERT_BASE64 || !env.ARCA_KEY_BASE64) return null;
    if (!certKeyPathsCache) {
      const dir = mkdtempSync(join(tmpdir(), 'kodu-arca-cred-'));
      const nuevoCertPath = join(dir, 'cert.pem');
      const nuevoKeyPath = join(dir, 'key.pem');
      writeFileSync(nuevoCertPath, Buffer.from(env.ARCA_CERT_BASE64, 'base64'));
      writeFileSync(nuevoKeyPath, Buffer.from(env.ARCA_KEY_BASE64, 'base64'));
      certKeyPathsCache = { certPath: nuevoCertPath, keyPath: nuevoKeyPath };
    }
    certPath = certKeyPathsCache.certPath;
    keyPath = certKeyPathsCache.keyPath;
  }

  return { cuit: env.ARCA_CUIT.replace(/\D/g, ''), puntoVenta: env.ARCA_PUNTO_VENTA, certPath, keyPath, entorno: env.ARCA_ENV };
}
