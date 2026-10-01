import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONDICION_IVA_RECEPTOR_ID, type FacturaInput, type Invoicer, type PingResultado, type ResultadoFactura } from './tipos.ts';
import { ticketStorePrisma, type TicketStore } from './ticket-store.ts';
import { escaparXml, extraerBloques, extraerTag, yyyymmdd } from './xml.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8/T8c): adaptador ARCA (ex-AFIP) de
 * `Invoicer` — WSAA (autenticación) + WSFEv1 (Factura C).
 *
 * T8c probó esto contra homologación de verdad (`wsaahomo`/`wswhomo`, CUIT
 * 20474963986, alias `koduhomo`) y encontró y arregló tres defectos que T8
 * (offline, nunca corrido contra ARCA) no podía haber visto:
 *
 * 1. **El TA se perdía en cada reinicio** (cache en memoria) y WSAA RECHAZA
 *    un login nuevo mientras el anterior sigue vigente
 *    (`coe.alreadyAuthenticated`, confirmado en vivo — ver el fixture de
 *    `e2e/unidad-facturador.ts`). Ahora se persiste en `ArcaAccessTicket`
 *    (`ticket-store.ts`) y el login está serializado con un advisory lock de
 *    Postgres por `cuit:entorno:service`.
 * 2. **Los pedidos de WSFEv1 no estaban namespace-calificados.** El WSDL real
 *    (`https://wswhomo.afip.gov.ar/wsfev1/service.asmx?WSDL`) declara
 *    `elementFormDefault="qualified"` sobre `targetNamespace="http://ar.gov.afip.dif.FEV1/"`:
 *    confirmado en vivo que un `<Auth>` sin el prefijo `ar:` es un "Auth no
 *    fue ingresado o esta mal formado" (código 500) aunque los datos estén
 *    bien. Todo elemento de los pedidos ahora lleva `ar:`.
 * 3. **Faltaba el header `SOAPAction`.** Confirmado en vivo: sin él, el
 *    ASMX devuelve un HTML de error genérico con HTTP 200 (ni siquiera un
 *    SOAP Fault legible); con
 *    `SOAPAction: "http://ar.gov.afip.dif.FEV1/<Operación>"` (de la propia
 *    tabla del WSDL) responde normal.
 *
 * Con las tres correcciones, T8c emitió en vivo (homologación, fake/gratis):
 * Factura C #1 (consumidor final, $7900, CAE 86400940988576) y #2 (CUIT
 * 30500010912 EXENTO, $7900, CAE 86400940989093), punto de venta 1.
 *
 * Firma CMS: `openssl cms -sign ... -outform DER` por `child_process` con
 * archivos temporales en `os.tmpdir()` (limpiados en un `finally`), tal como
 * documenta el manual del desarrollador de WSAA (CMS "pelado" en base64, no
 * S/MIME). `openssl` está instalado en la imagen (Dockerfile) y en este host.
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
/** `targetNamespace` del WSDL de WSFEv1 — confirmado contra el WSDL real
 *  (misma URL de arriba con `?WSDL`), `elementFormDefault="qualified"`. */
const WSFE_NAMESPACE = 'http://ar.gov.afip.dif.FEV1/';

const SERVICE = 'wsfe';
const CBTE_TIPO_FACTURA_C = 11;
const DOC_TIPO_CUIT = 80;
const DOC_TIPO_CONSUMIDOR_FINAL = 99;

/** Duración máxima de un TA de WSAA — confirmada en vivo: `generationTime` a
 *  `expirationTime` da exactamente 12hs (no hay forma de pedirle a WSAA la
 *  expiración de un TA ajeno, así que esto sirve de COTA SUPERIOR cuando no
 *  tenemos guardado el TA que está vigente — ver `estimarLiberacion`). */
const DURACION_MAXIMA_TA_MS = 12 * 60 * 60 * 1000;

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

/** `coe.alreadyAuthenticated` — WSAA rechaza un login nuevo mientras el TA
 *  anterior (de Kodu, de otra instancia, o de antes de que existiera esta
 *  persistencia) sigue vigente. Confirmado EN VIVO contra homologación
 *  (T8c): `HTTP 500`, cuerpo
 *  `<soapenv:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode>
 *  <faultstring>El CEE ya posee un TA valido para el acceso al WSN
 *  solicitado</faultstring>...` — SIN la hora de expiración del TA vigente
 *  (WSAA no la informa), de ahí `estimarLiberacion`. */
export class WsaaAlreadyAuthenticatedError extends Error {
  constructor(mensajeArca: string) {
    super(mensajeArca);
    this.name = 'WsaaAlreadyAuthenticatedError';
  }
}

function esFaultAlreadyAuthenticated(cuerpoFault: string): boolean {
  return /alreadyAuthenticated/i.test(cuerpoFault);
}

/** Hora de Argentina (UTC-3 fijo, igual criterio que `ciclo.ts#fechaAr`) en
 *  `HH:MM`, para el mensaje de `WsaaAlreadyAuthenticatedError`. */
function horaArgentina(instante: Date): string {
  const desplazado = new Date(instante.getTime() - 3 * 60 * 60 * 1000);
  const hh = String(desplazado.getUTCHours()).padStart(2, '0');
  const mm = String(desplazado.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Cuándo se libera, como mucho, el TA ajeno que está bloqueando el login.
 * Si tenemos guardado un TA para esta llave (aunque nuestro margen de
 * renovación ya lo haya dado por "por vencer"), su `expirationTime` real es
 * la mejor cota: es el mismo TA que WSAA todavía reconoce como vigente. Si
 * no hay nada guardado (el caso que de verdad preocupa: un TA obtenido antes
 * de esta persistencia, o por otro proceso), la única cota segura es "ahora
 * + duración máxima de un TA" (12hs, confirmado en vivo).
 */
export function estimarLiberacion(ticketGuardado: LoginTicket | null, ahora: Date): Date {
  return ticketGuardado ? ticketGuardado.expirationTime : new Date(ahora.getTime() + DURACION_MAXIMA_TA_MS);
}

// Nota de T8c: en la corrida en vivo contra homologación, un segundo login
// (sin nada guardado) volvió a funcionar bastante antes de las 12hs —
// homologación parece liberar el bloqueo de `alreadyAuthenticated` más rápido
// que la validez real del TA. La cota de 12hs de acá queda a propósito
// (nunca promete una hora más temprana de la que puede cumplir); si el
// bloqueo se libera antes, el próximo intento de facturar simplemente
// funciona antes de lo que el mensaje prometió.

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
  if (!respuesta.ok) {
    if (esFaultAlreadyAuthenticated(cuerpo)) {
      throw new WsaaAlreadyAuthenticatedError(extraerTag(cuerpo, 'faultstring') ?? 'coe.alreadyAuthenticated');
    }
    throw new Error(`WSAA respondió ${respuesta.status}: ${cuerpo.slice(0, 500)}`);
  }
  // La respuesta trae el LoginTicketResponse XML escapado dentro del SOAP body.
  const interno = extraerTag(cuerpo, 'loginCmsReturn') ?? cuerpo;
  const desescapado = interno.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  return parsearLoginTicketResponse(desescapado);
}

const MARGEN_EXPIRACION_MS = 10 * 60 * 1000; // renueva 10' antes de que venza, no al filo.

/** `true` si todavía falta más del margen de renovación para que venza —
 *  función PURA, exportada para probar el manejo de expiración sin pegarle a
 *  WSAA (`e2e/unidad-facturador.ts`). */
export function ticketVigente(ticket: LoginTicket, ahora: Date): boolean {
  return ticket.expirationTime.getTime() - MARGEN_EXPIRACION_MS > ahora.getTime();
}

/**
 * Ticket vigente para `config`, leyendo primero el store persistido
 * (`ticket-store.ts`) y logueando contra WSAA sólo si hace falta — todo bajo
 * `store.withLock` para que dos procesos no logueen en paralelo (uno
 * pisaría el TA del otro con un login más viejo, o los dos chocarían contra
 * `alreadyAuthenticated`).
 *
 * Si WSAA rechaza por `alreadyAuthenticated`, el error que sale de acá ya
 * trae el mensaje final para `/admin/facturacion` (T8c, punto 1 del
 * informe): "ARCA tiene un acceso vigente que Kodu no guardó; se libera
 * como máximo a las HH:MM...".
 *
 * `login` es inyectable (default `loginWSAA`) para que
 * `e2e/unidad-facturador.ts` pruebe la persistencia, el lock y el manejo de
 * `alreadyAuthenticated` con un store en memoria y un login falso — SIN
 * pegarle a WSAA (misma regla offline de siempre de este archivo de
 * pruebas).
 */
export async function obtenerTicketVigente(
  config: ArcaConfig,
  store: TicketStore,
  login: (config: ArcaConfig) => Promise<LoginTicket> = loginWSAA,
): Promise<LoginTicket> {
  return store.withLock(config.cuit, config.entorno, SERVICE, async () => {
    const guardado = await store.leer(config.cuit, config.entorno, SERVICE);
    if (guardado && ticketVigente(guardado, new Date())) return guardado;

    try {
      const nuevo = await login(config);
      await store.guardar(config.cuit, config.entorno, SERVICE, nuevo);
      return nuevo;
    } catch (error) {
      if (error instanceof WsaaAlreadyAuthenticatedError) {
        const limite = horaArgentina(estimarLiberacion(guardado, new Date()));
        throw new WsaaAlreadyAuthenticatedError(
          `ARCA tiene un acceso vigente que Kodu no guardó; se libera como máximo a las ${limite} (hora de Argentina) o pedí un certificado nuevo.`,
        );
      }
      throw error;
    }
  });
}

// ─────────────────────────────────────────────────────────────
// WSFEv1 — FEDummy, FECompUltimoAutorizado y FECAESolicitar
// ─────────────────────────────────────────────────────────────

function soapHeader(auth: LoginTicket, cuit: string): string {
  return `<ar:Auth><ar:Token>${escaparXml(auth.token)}</ar:Token><ar:Sign>${escaparXml(auth.sign)}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
}

function envoltorioSoap(cuerpo: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${WSFE_NAMESPACE}">` +
    `<soapenv:Header/><soapenv:Body>${cuerpo}</soapenv:Body></soapenv:Envelope>`
  );
}

export function construirFeDummyRequest(): string {
  return envoltorioSoap('<ar:FEDummy/>');
}

export function construirFeCompUltimoAutorizadoRequest(auth: LoginTicket, cuit: string, ptoVta: number): string {
  return envoltorioSoap(
    `<ar:FECompUltimoAutorizado>${soapHeader(auth, cuit)}<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${CBTE_TIPO_FACTURA_C}</ar:CbteTipo></ar:FECompUltimoAutorizado>`,
  );
}

/** Un `<Err>` de ARCA, a nivel SOAP (`<Errors>`) o de detalle
 *  (`<Observaciones>`) — siempre trae `Code` + `Msg` en el manual del
 *  desarrollador de WSFEv1. */
export interface ArcaErrorDetalle {
  code: string;
  message: string;
}

function extraerErrores(xml: string): ArcaErrorDetalle[] {
  return extraerBloques(xml, 'Err').map((bloque) => ({
    code: extraerTag(bloque, 'Code') ?? '?',
    message: extraerTag(bloque, 'Msg') ?? 'ARCA no informó un mensaje.',
  }));
}

function formatearErrores(errores: ArcaErrorDetalle[]): string {
  return errores.map((error) => `[${error.code}] ${error.message}`).join(' / ');
}

export interface FeCompUltimoAutorizadoParseado {
  /** `null` si ARCA no devolvió `CbteNro` (siempre que haya `errores`). */
  cbteNro: number | null;
  errores: ArcaErrorDetalle[];
}

/** Parsea `FECompUltimoAutorizadoResponse` — éxito (`CbteNro`) o un
 *  `<Errors>` a nivel SOAP (p.ej. "Auth no fue ingresado o esta mal
 *  formado", confirmado en vivo contra homologación con un pedido sin
 *  namespace-calificar — T8c). Antes de esta tarea esto tiraba un genérico
 *  "no devolvió CbteNro"; ahora el código+mensaje de ARCA llega entero al
 *  llamador. */
export function parsearFeCompUltimoAutorizadoResponse(xml: string): FeCompUltimoAutorizadoParseado {
  const errores = extraerErrores(xml);
  const nro = extraerTag(xml, 'CbteNro');
  return { cbteNro: nro !== null ? Number(nro) : null, errores };
}

export function construirFECAESolicitarRequest(auth: LoginTicket, cuit: string, ptoVta: number, cbteNro: number, input: FacturaInput): string {
  const docTipo = input.recipient.kind === 'cuit' ? DOC_TIPO_CUIT : DOC_TIPO_CONSUMIDOR_FINAL;
  const docNro = input.recipient.kind === 'cuit' ? input.recipient.docNumber.replace(/\D/g, '') : '0';
  const condicionIvaReceptorId =
    input.recipient.kind === 'cuit' ? CONDICION_IVA_RECEPTOR_ID[input.recipient.ivaCondition] : CONDICION_IVA_RECEPTOR_ID.CONSUMIDOR_FINAL;
  const importe = Math.round(input.amountArs * 100) / 100;

  // Orden de campos EXACTO según el `xsd:sequence` de `FEDetRequest` en el
  // WSDL real (confirmado: Concepto, DocTipo, DocNro, CbteDesde, CbteHasta,
  // CbteFch, ImpTotal, ImpTotConc, ImpNeto, ImpOpEx, ImpTrib, ImpIVA,
  // FchServDesde, FchServHasta, FchVtoPago, MonId, MonCotiz, ...,
  // CondicionIVAReceptorId) — T8 tenía ImpIVA antes que ImpTrib, al revés
  // del schema.
  const detalle =
    `<ar:FECAEDetRequest>` +
    `<ar:Concepto>2</ar:Concepto>` + // 2 = servicios: Kodu siempre es un servicio.
    `<ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docNro}</ar:DocNro>` +
    `<ar:CbteDesde>${cbteNro}</ar:CbteDesde><ar:CbteHasta>${cbteNro}</ar:CbteHasta>` +
    `<ar:CbteFch>${yyyymmdd(input.paymentDate)}</ar:CbteFch>` +
    `<ar:ImpTotal>${importe}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${importe}</ar:ImpNeto>` +
    `<ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA>` +
    `<ar:FchServDesde>${yyyymmdd(input.periodStart)}</ar:FchServDesde><ar:FchServHasta>${yyyymmdd(input.periodEnd)}</ar:FchServHasta>` +
    `<ar:FchVtoPago>${yyyymmdd(input.paymentDate)}</ar:FchVtoPago>` +
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${condicionIvaReceptorId}</ar:CondicionIVAReceptorId>` +
    `</ar:FECAEDetRequest>`;

  return envoltorioSoap(
    `<ar:FECAESolicitar>${soapHeader(auth, cuit)}` +
      `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${CBTE_TIPO_FACTURA_C}</ar:CbteTipo></ar:FeCabReq>` +
      `<ar:FeDetReq>${detalle}</ar:FeDetReq></ar:FeCAEReq>` +
      `</ar:FECAESolicitar>`,
  );
}

export interface FECAESolicitarParseado {
  resultado: 'A' | 'R' | 'P' | null;
  cae: string | null;
  caeFchVto: string | null;
  observaciones: string[];
  errores: ArcaErrorDetalle[];
}

/** Parsea una respuesta de `FECAESolicitar` — éxito (`Resultado=A`, `CAE` +
 *  `CAEFchVto`) o rechazo/observado (`Resultado=R`/`P` + `Observaciones`), más
 *  el array `<Errors>` a nivel SOAP (p.ej. token vencido) con código+mensaje. */
export function parsearFECAESolicitarResponse(xml: string): FECAESolicitarParseado {
  const resultado = extraerTag(xml, 'Resultado') as 'A' | 'R' | 'P' | null;
  const cae = extraerTag(xml, 'CAE');
  const caeFchVto = extraerTag(xml, 'CAEFchVto');

  const observaciones = extraerBloques(xml, 'Obs')
    .map((bloque) => extraerTag(bloque, 'Msg'))
    .filter((msg): msg is string => msg !== null);
  const errores = extraerErrores(xml);

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
  constructor(
    private readonly config: ArcaConfig,
    private readonly ticketStore: TicketStore = ticketStorePrisma,
  ) {}

  /** `FEDummy` — no requiere `Auth`, así que sirve de chequeo de salud sin
   *  depender de que WSAA esté sano (usado por `/admin/facturacion`, T8c). */
  async ping(): Promise<PingResultado> {
    try {
      const xml = await llamarWsfe(this.config.entorno, 'FEDummy', construirFeDummyRequest());
      return {
        ok: true,
        appServer: extraerTag(xml, 'AppServer') ?? undefined,
        dbServer: extraerTag(xml, 'DbServer') ?? undefined,
        authServer: extraerTag(xml, 'AuthServer') ?? undefined,
      };
    } catch (error) {
      return { ok: false, error: mensajeDeError(error) };
    }
  }

  async issueInvoiceC(input: FacturaInput): Promise<ResultadoFactura> {
    let auth: LoginTicket;
    try {
      auth = await obtenerTicketVigente(this.config, this.ticketStore);
    } catch (error) {
      if (error instanceof WsaaAlreadyAuthenticatedError) {
        return { ok: false, error: { kind: 'auth_conflict', message: error.message } };
      }
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
        const xml = await llamarWsfe(this.config.entorno, 'FECompUltimoAutorizado', pedido);
        const parseado = parsearFeCompUltimoAutorizadoResponse(xml);
        if (parseado.errores.length > 0) {
          return { ok: false, error: { kind: 'rejected', message: formatearErrores(parseado.errores) } };
        }
        if (parseado.cbteNro === null) {
          return { ok: false, error: { kind: 'network', message: 'FECompUltimoAutorizado no devolvió CbteNro ni Errors.' } };
        }
        cbteNro = parseado.cbteNro + 1;
      } catch (error) {
        return { ok: false, error: { kind: 'network', message: `No se pudo leer el último comprobante autorizado: ${mensajeDeError(error)}` } };
      }

      let parseado: FECAESolicitarParseado;
      try {
        const pedido = construirFECAESolicitarRequest(auth, this.config.cuit, this.config.puntoVenta, cbteNro, input);
        const xml = await llamarWsfe(this.config.entorno, 'FECAESolicitar', pedido);
        parseado = parsearFECAESolicitarResponse(xml);
      } catch (error) {
        return { ok: false, error: { kind: 'network', message: `No se pudo pedir el CAE: ${mensajeDeError(error)}` } };
      }

      if (parseado.errores.length > 0) {
        const esDeNumeracion = parseado.errores.some((error) => /numeracion|numero de comprobante/i.test(error.message));
        if (esDeNumeracion && intento === 0) continue; // reintenta releyendo el último autorizado.
        return { ok: false, error: { kind: 'rejected', message: formatearErrores(parseado.errores) } };
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

async function llamarWsfe(entorno: 'homologacion' | 'produccion', operacion: string, soapBody: string): Promise<string> {
  const respuesta = await fetch(WSFE_URL[entorno], {
    method: 'POST',
    // SOAPAction es obligatorio para este servicio ASMX/SOAP 1.1: confirmado
    // en vivo (T8c) que sin él responde un HTML de error genérico con HTTP
    // 200 en vez de ejecutar la operación. El valor exacto sale de la tabla
    // de operaciones del WSDL real.
    headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${WSFE_NAMESPACE}${operacion}"` },
    body: soapBody,
  });
  const cuerpo = await respuesta.text();
  if (!respuesta.ok) throw new Error(`WSFEv1 respondió ${respuesta.status}: ${cuerpo.slice(0, 500)}`);
  return cuerpo;
}

function mensajeDeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
