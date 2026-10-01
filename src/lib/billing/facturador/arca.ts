import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONDICION_IVA_RECEPTOR_ID, type FacturaInput, type Invoicer, type ResultadoFactura } from './tipos.ts';
import { escaparXml, extraerBloques, extraerTag, yyyymmdd } from './xml.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8): adaptador ARCA (ex-AFIP) de `Invoicer` —
 * WSAA (autenticación) + WSFEv1 (Factura C). SIN CREDENCIALES REALES en este
 * worktree: se construyó y se probó offline (`e2e/unidad-facturador.ts`),
 * nunca se llamó a un endpoint real de ARCA desde esta sesión (ni
 * homologación ni producción) — ver el informe de T8 para el detalle de qué
 * se pudo confirmar contra la documentación oficial y qué queda como gap.
 *
 * Firma CMS: se eligió `openssl cms -sign ... -outform DER` por
 * `child_process` con archivos temporales en `os.tmpdir()` (limpiados en un
 * `finally`), en vez de `openssl smime`, porque `cms` es el comando que
 * documenta el propio manual del desarrollador de WSAA y evita la
 * codificación S/MIME (que WSAA no espera: quiere el CMS "pelado" en
 * base64). `openssl` está instalado en la imagen (Dockerfile) y en este host.
 *
 * Caché de token: en MEMORIA del proceso (`Map`), no en la base — el token
 * dura ~12hs y perderlo en un reinicio del servidor sólo cuesta un login de
 * más; no vale la complejidad de persistirlo. Si el día de mañana corren
 * varias instancias del servidor, cada una loguea el suyo (WSAA lo permite:
 * no hay límite de tokens concurrentes documentado).
 */

export interface ArcaConfig {
  cuit: string;
  puntoVenta: number;
  certPath: string;
  keyPath: string;
  entorno: 'homologacion' | 'produccion';
}

const WSAA_URL = {
  homologacion: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  produccion: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
};
const WSFE_URL = {
  homologacion: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  produccion: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
};

const SERVICE = 'wsfe';
const CBTE_TIPO_FACTURA_C = 11;
const DOC_TIPO_CUIT = 80;
const DOC_TIPO_CONSUMIDOR_FINAL = 99;

// ─────────────────────────────────────────────────────────────
// WSAA — TRA, firma CMS, LoginCms
// ─────────────────────────────────────────────────────────────

/** El TRA (`LoginTicketRequest`) tal como lo pide el manual de WSAA: un
 *  `uniqueId` (segundos desde epoch, entero), `generationTime` unos minutos
 *  antes de ahora y `expirationTime` unos minutos después (margen contra
 *  desfasaje de reloj — ARCA rechaza un TRA "del futuro" o ya vencido). */
export function construirTRA(service: string, ahora: Date): string {
  const margenMs = 5 * 60 * 1000;
  const uniqueId = Math.floor(ahora.getTime() / 1000);
  const generationTime = new Date(ahora.getTime() - margenMs).toISOString();
  const expirationTime = new Date(ahora.getTime() + margenMs).toISOString();
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header><uniqueId>${uniqueId}</uniqueId><generationTime>${generationTime}</generationTime><expirationTime>${expirationTime}</expirationTime></header>` +
    `<service>${service}</service>` +
    `</loginTicketRequest>`
  );
}

/**
 * Firma el TRA con `openssl cms -sign` (CMS/PKCS#7, DER, `-nodetach`) y
 * devuelve el resultado en base64 — exactamente el cuerpo que espera
 * `LoginCms`. Usa dos archivos temporales (TRA de entrada, CMS de salida) en
 * `os.tmpdir()`, borrados siempre al terminar.
 */
export async function firmarTRA(traXml: string, certPath: string, keyPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kodu-arca-'));
  const traPath = join(dir, 'tra.xml');
  const cmsPath = join(dir, 'tra.cms');
  try {
    await writeFile(traPath, traXml, 'utf8');
    await ejecutarOpenssl(['cms', '-sign', '-signer', certPath, '-inkey', keyPath, '-nodetach', '-outform', 'DER', '-in', traPath, '-out', cmsPath]);
    const der = await readFile(cmsPath);
    return der.toString('base64');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ejecutarOpenssl(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proceso = spawn('openssl', args);
    let stderr = '';
    proceso.stderr.on('data', (chunk) => (stderr += String(chunk)));
    proceso.on('error', (error) => reject(new Error(`No se pudo ejecutar openssl: ${error.message}`)));
    proceso.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`openssl ${args[0]} terminó con código ${code}: ${stderr.trim()}`));
    });
  });
}

export interface LoginTicket {
  token: string;
  sign: string;
  expirationTime: Date;
}

export function parsearLoginTicketResponse(xml: string): LoginTicket {
  const token = extraerTag(xml, 'token');
  const sign = extraerTag(xml, 'sign');
  const expirationTime = extraerTag(xml, 'expirationTime');
  if (!token || !sign || !expirationTime) {
    throw new Error('LoginTicketResponse de WSAA incompleto: faltan token/sign/expirationTime.');
  }
  return { token, sign, expirationTime: new Date(expirationTime) };
}

const SOAP_ENVELOPE_WSAA = (cmsBase64: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
  `<soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>${cmsBase64}</wsaa:in0></wsaa:loginCms></soapenv:Body>` +
  `</soapenv:Envelope>`;

async function loginWSAA(config: ArcaConfig): Promise<LoginTicket> {
  const tra = construirTRA(SERVICE, new Date());
  const cms = await firmarTRA(tra, config.certPath, config.keyPath);
  const respuesta = await fetch(WSAA_URL[config.entorno], {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: SOAP_ENVELOPE_WSAA(cms),
  });
  const cuerpo = await respuesta.text();
  if (!respuesta.ok) throw new Error(`WSAA respondió ${respuesta.status}: ${cuerpo.slice(0, 500)}`);
  // La respuesta trae el LoginTicketResponse XML escapado dentro del SOAP body.
  const interno = extraerTag(cuerpo, 'loginCmsReturn') ?? cuerpo;
  const desescapado = interno.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return parsearLoginTicketResponse(desescapado);
}

/** Caché de token EN MEMORIA (ver el comentario del módulo), por `cuit:entorno`. */
const cacheTokens = new Map<string, LoginTicket>();
const MARGEN_EXPIRACION_MS = 10 * 60 * 1000; // renueva 10' antes de que venza, no al filo.

/** `true` si todavía falta más del margen de renovación para que venza —
 *  función PURA, exportada para probar el manejo de expiración sin pegarle a
 *  WSAA (`e2e/unidad-facturador.ts`). */
export function ticketVigente(ticket: LoginTicket, ahora: Date): boolean {
  return ticket.expirationTime.getTime() - MARGEN_EXPIRACION_MS > ahora.getTime();
}

async function obtenerTicketVigente(config: ArcaConfig): Promise<LoginTicket> {
  const clave = `${config.cuit}:${config.entorno}`;
  const cacheado = cacheTokens.get(clave);
  if (cacheado && ticketVigente(cacheado, new Date())) return cacheado;
  const nuevo = await loginWSAA(config);
  cacheTokens.set(clave, nuevo);
  return nuevo;
}

// ─────────────────────────────────────────────────────────────
// WSFEv1 — FECompUltimoAutorizado y FECAESolicitar
// ─────────────────────────────────────────────────────────────

function soapHeader(auth: LoginTicket, cuit: string): string {
  return `<Auth><Token>${escaparXml(auth.token)}</Token><Sign>${escaparXml(auth.sign)}</Sign><Cuit>${cuit}</Cuit></Auth>`;
}

export function construirFeCompUltimoAutorizadoRequest(auth: LoginTicket, cuit: string, ptoVta: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/><soapenv:Body><ar:FECompUltimoAutorizado>` +
    soapHeader(auth, cuit) +
    `<PtoVta>${ptoVta}</PtoVta><CbteTipo>${CBTE_TIPO_FACTURA_C}</CbteTipo>` +
    `</ar:FECompUltimoAutorizado></soapenv:Body></soapenv:Envelope>`
  );
}

export function parsearFeCompUltimoAutorizadoResponse(xml: string): number {
  const nro = extraerTag(xml, 'CbteNro');
  if (nro === null) throw new Error('FECompUltimoAutorizado no devolvió CbteNro.');
  return Number(nro);
}

export function construirFECAESolicitarRequest(auth: LoginTicket, cuit: string, ptoVta: number, cbteNro: number, input: FacturaInput): string {
  const docTipo = input.recipient.kind === 'cuit' ? DOC_TIPO_CUIT : DOC_TIPO_CONSUMIDOR_FINAL;
  const docNro = input.recipient.kind === 'cuit' ? input.recipient.docNumber.replace(/\D/g, '') : '0';
  const condicionIvaReceptorId =
    input.recipient.kind === 'cuit' ? CONDICION_IVA_RECEPTOR_ID[input.recipient.ivaCondition] : CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL;
  const importe = Math.round(input.amountArs * 100) / 100;

  const detalle =
    `<FECAEDetRequest>` +
    `<Concepto>2</Concepto>` + // 2 = servicios: Kodu siempre es un servicio.
    `<DocTipo>${docTipo}</DocTipo><DocNro>${docNro}</DocNro>` +
    `<CbteDesde>${cbteNro}</CbteDesde><CbteHasta>${cbteNro}</CbteHasta>` +
    `<CbteFch>${yyyymmdd(input.paymentDate)}</CbteFch>` +
    `<ImpTotal>${importe}</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>${importe}</ImpNeto>` +
    `<ImpOpEx>0</ImpOpEx><ImpIVA>0</ImpIVA><ImpTrib>0</ImpTrib>` +
    `<FchServDesde>${yyyymmdd(input.periodStart)}</FchServDesde><FchServHasta>${yyyymmdd(input.periodEnd)}</FchServHasta>` +
    `<FchVtoPago>${yyyymmdd(input.paymentDate)}</FchVtoPago>` +
    `<MonId>PES</MonId><MonCotiz>1</MonCotiz>` +
    `<CondicionIVAReceptorId>${condicionIvaReceptorId}</CondicionIVAReceptorId>` +
    `</FECAEDetRequest>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/">` +
    `<soapenv:Header/><soapenv:Body><ar:FECAESolicitar>` +
    soapHeader(auth, cuit) +
    `<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${ptoVta}</PtoVta><CbteTipo>${CBTE_TIPO_FACTURA_C}</CbteTipo></FeCabReq>` +
    `<FeDetReq>${detalle}</FeDetReq></FeCAEReq>` +
    `</ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>`
  );
}

export interface FECAESolicitarParseado {
  resultado: 'A' | 'R' | 'P' | null;
  cae: string | null;
  caeFchVto: string | null;
  observaciones: string[];
  errores: string[];
}

/** Parsea una respuesta de `FECAESolicitar` — éxito (`Resultado=A`, `CAE` +
 *  `CAEFchVto`) o rechazo/observado (`Resultado=R`/`P` + `Observaciones`), más
 *  el array `<Errors>` a nivel SOAP (p.ej. token vencido). */
export function parsearFECAESolicitarResponse(xml: string): FECAESolicitarParseado {
  const resultado = extraerTag(xml, 'Resultado') as 'A' | 'R' | 'P' | null;
  const cae = extraerTag(xml, 'CAE');
  const caeFchVto = extraerTag(xml, 'CAEFchVto');

  const observaciones = extraerBloques(xml, 'Obs')
    .map((bloque) => extraerTag(bloque, 'Msg'))
    .filter((msg): msg is string => msg !== null);
  const errores = extraerBloques(xml, 'Err')
    .map((bloque) => extraerTag(bloque, 'Msg'))
    .filter((msg): msg is string => msg !== null);

  return { resultado, cae, caeFchVto, observaciones, errores };
}

/** `CAEFchVto` viene como `yyyymmdd`; se interpreta como medianoche de
 *  Argentina de ese día (mismo criterio que el resto del módulo). */
function parsearFechaYyyymmdd(valor: string): Date {
  const year = Number(valor.slice(0, 4));
  const month = Number(valor.slice(4, 6));
  const day = Number(valor.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day) + 3 * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────
// Invoicer
// ─────────────────────────────────────────────────────────────

export class FacturadorArca implements Invoicer {
  constructor(private readonly config: ArcaConfig) {}

  async issueInvoiceC(input: FacturaInput): Promise<ResultadoFactura> {
    let auth: LoginTicket;
    try {
      auth = await obtenerTicketVigente(this.config);
    } catch (error) {
      return { ok: false, error: { kind: 'network', message: `No se pudo autenticar contra WSAA: ${mensajeDeError(error)}` } };
    }

    // Reintento de "último autorizado" + colisión de número: si entre el
    // FECompUltimoAutorizado y el FECAESolicitar otro proceso ya emitió el
    // siguiente número (dos intentos concurrentes contra el mismo punto de
    // venta), ARCA rechaza con una observación de numeración — se vuelve a
    // leer el último autorizado UNA vez más antes de reintentar.
    for (let intento = 0; intento < 2; intento++) {
      let cbteNro: number;
      try {
        const pedido = construirFeCompUltimoAutorizadoRequest(auth, this.config.cuit, this.config.puntoVenta);
        const xml = await llamarWsfe(this.config.entorno, pedido);
        cbteNro = parsearFeCompUltimoAutorizadoResponse(xml) + 1;
      } catch (error) {
        return { ok: false, error: { kind: 'network', message: `No se pudo leer el último comprobante autorizado: ${mensajeDeError(error)}` } };
      }

      let parseado: FECAESolicitarParseado;
      try {
        const pedido = construirFECAESolicitarRequest(auth, this.config.cuit, this.config.puntoVenta, cbteNro, input);
        const xml = await llamarWsfe(this.config.entorno, pedido);
        parseado = parsearFECAESolicitarResponse(xml);
      } catch (error) {
        return { ok: false, error: { kind: 'network', message: `No se pudo pedir el CAE: ${mensajeDeError(error)}` } };
      }

      if (parseado.errores.length > 0) {
        const esDeNumeracion = parseado.errores.some((msg) => /numeracion|numero de comprobante/i.test(msg));
        if (esDeNumeracion && intento === 0) continue; // reintenta releyendo el último autorizado.
        return { ok: false, error: { kind: 'rejected', message: parseado.errores.join(' / ') } };
      }

      if (parseado.resultado !== 'A' || !parseado.cae || !parseado.caeFchVto) {
        return {
          ok: false,
          error: { kind: 'rejected', message: parseado.observaciones.join(' / ') || 'ARCA no otorgó el CAE.', observaciones: parseado.observaciones },
        };
      }

      const condicionIvaReceptorId =
        input.recipient.kind === 'cuit' ? CONDICION_IVA_RECEPTOR_ID[input.recipient.ivaCondition] : CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL;

      return {
        ok: true,
        data: {
          pointOfSale: this.config.puntoVenta,
          number: cbteNro,
          cae: parseado.cae,
          caeDueDate: parsearFechaYyyymmdd(parseado.caeFchVto),
          condicionIvaReceptorId,
        },
      };
    }

    return { ok: false, error: { kind: 'rejected', message: 'No se pudo obtener un número de comprobante libre tras reintentar.' } };
  }
}

async function llamarWsfe(entorno: 'homologacion' | 'produccion', soapBody: string): Promise<string> {
  const respuesta = await fetch(WSFE_URL[entorno], {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
    body: soapBody,
  });
  const cuerpo = await respuesta.text();
  if (!respuesta.ok) throw new Error(`WSFEv1 respondió ${respuesta.status}: ${cuerpo.slice(0, 500)}`);
  return cuerpo;
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
