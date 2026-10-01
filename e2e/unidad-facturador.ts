import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  construirFECAESolicitarRequest,
  construirFeCompUltimoAutorizadoRequest,
  construirFeDummyRequest,
  construirTRA,
  estimarLiberacion,
  firmarTRA,
  obtenerTicketVigente,
  parsearFECAESolicitarResponse,
  parsearFeCompUltimoAutorizadoResponse,
  parsearLoginTicketResponse,
  ticketVigente,
  WsaaAlreadyAuthenticatedError,
  type ArcaConfig,
  type LoginTicket,
} from '../src/lib/billing/facturador/arca.ts';
import { crearTicketStoreEnMemoria } from '../src/lib/billing/facturador/ticket-store.ts';
import { yyyymmdd } from '../src/lib/billing/facturador/xml.ts';
import type { FacturaInput } from '../src/lib/billing/facturador/tipos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8c): pruebas unitarias, offline, del
 * adaptador ARCA — NUNCA pega contra `wsaahomo.afip.gov.ar` ni contra WSFEv1
 * real. Lo que prueba T8c que T8 (nunca corrido contra ARCA) no podía:
 *
 * - Que los pedidos de WSFEv1 llevan el prefijo `ar:` en TODOS los elementos
 *   (namespace-calificados, `elementFormDefault="qualified"` del WSDL real).
 * - El `SOAPAction` exacto por operación.
 * - El orden EXACTO de `FECAEDetRequest` según el `xsd:sequence` del WSDL
 *   (`ImpOpEx`, `ImpTrib`, `ImpIVA`, en ese orden).
 * - El parseo de `<Errors>` con código+mensaje, tanto en
 *   `FECompUltimoAutorizadoResponse` (fixture tomado de una respuesta REAL
 *   de homologación: "Auth no fue ingresado o esta mal formado" cuando el
 *   pedido no estaba namespace-calificado) como en `FECAESolicitarResponse`.
 * - El manejo de `coe.alreadyAuthenticated` (fixture tomado de un SOAP Fault
 *   REAL de homologación — T8c lo disparó a propósito con un TA ya vigente).
 * - La persistencia del TA: lee el store antes de loguear, guarda después de
 *   loguear, no loguea si ya hay uno vigente, y serializa dos llamadas
 *   concurrentes con `withLock` (un login en vez de dos).
 * - El formato de fecha `yyyymmdd` en hora de Argentina y la firma CMS con
 *   `openssl cms -sign` contra un certificado autofirmado generado EN LA
 *   PRUEBA.
 *
 * Ejecutar con: npx tsx e2e/unidad-facturador.ts
 */

let fallas = 0;

async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).stack ?? error}`);
  }
}

function ejecutar(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proceso = spawn(cmd, args);
    let stderr = '';
    proceso.stderr.on('data', (chunk) => (stderr += String(chunk)));
    proceso.on('error', reject);
    proceso.on('close', (code) => resolve({ code: code ?? -1, stderr }));
  });
}

const authFake: LoginTicket = { token: 'TOKEN-FAKE', sign: 'SIGN-FAKE', expirationTime: new Date('2026-10-15T22:00:00Z') };
const configFake: ArcaConfig = { cuit: '20111111112', puntoVenta: 3, certPath: '', keyPath: '', entorno: 'homologacion' };

// ─────────────────────────────────────────────────────────────
// yyyymmdd — hora de Argentina (UTC-3 fijo)
// ─────────────────────────────────────────────────────────────

await prueba('yyyymmdd: usa el día en hora de Argentina, no en UTC', () => {
  // 2026-10-15T02:00:00Z son las 23:00 del 14/10 en Argentina (UTC-3).
  assert.equal(yyyymmdd(new Date('2026-10-15T02:00:00Z')), '20261014');
  assert.equal(yyyymmdd(new Date('2026-10-15T12:00:00Z')), '20261015');
});

// ─────────────────────────────────────────────────────────────
// WSFEv1 — namespace, SOAPAction y orden de campos (T8c)
// ─────────────────────────────────────────────────────────────

await prueba('construirFeDummyRequest: el elemento va namespace-calificado con ar:', () => {
  const xml = construirFeDummyRequest();
  assert.match(xml, /xmlns:ar="http:\/\/ar\.gov\.afip\.dif\.FEV1\/"/);
  assert.match(xml, /<ar:FEDummy\s*\/>/);
});

await prueba('construirFeCompUltimoAutorizadoRequest: Auth, PtoVta y CbteTipo llevan el prefijo ar:', () => {
  const xml = construirFeCompUltimoAutorizadoRequest(authFake, '20111111112', 3);
  assert.match(xml, /<ar:Auth><ar:Token>TOKEN-FAKE<\/ar:Token><ar:Sign>SIGN-FAKE<\/ar:Sign><ar:Cuit>20111111112<\/ar:Cuit><\/ar:Auth>/);
  assert.match(xml, /<ar:PtoVta>3<\/ar:PtoVta>/);
  assert.match(xml, /<ar:CbteTipo>11<\/ar:CbteTipo>/);
  // Nunca sin prefijo: un <PtoVta> suelto (sin ar:) es exactamente el defecto
  // que ARCA rechazó en vivo con "Auth no fue ingresado o esta mal formado".
  assert.doesNotMatch(xml, /<PtoVta>/);
  assert.doesNotMatch(xml, /<Auth>/);
});

const inputOrg: FacturaInput = {
  pointOfSale: 3,
  periodStart: new Date('2026-10-01T12:00:00Z'),
  periodEnd: new Date('2026-10-31T12:00:00Z'),
  paymentDate: new Date('2026-10-05T12:00:00Z'),
  amountArs: 15000.5,
  recipient: { kind: 'cuit', docNumber: '20-12345678-6', name: 'Escuela E2E SRL', ivaCondition: 'MONOTRIBUTO' },
};

const inputIndividual: FacturaInput = {
  pointOfSale: 3,
  periodStart: new Date('2026-10-01T12:00:00Z'),
  periodEnd: new Date('2026-10-31T12:00:00Z'),
  paymentDate: new Date('2026-10-05T12:00:00Z'),
  amountArs: 4500,
  recipient: { kind: 'consumidor_final', name: 'Docente E2E' },
};

await prueba('FECAESolicitar (org): namespace ar: en todo, DocTipo 80, CondicionIVAReceptorId de MONOTRIBUTO (6), Concepto 2', () => {
  const xml = construirFECAESolicitarRequest(authFake, '20111111112', 3, 15, inputOrg);
  assert.match(xml, /<ar:DocTipo>80<\/ar:DocTipo>/);
  assert.match(xml, /<ar:DocNro>20123456786<\/ar:DocNro>/);
  assert.match(xml, /<ar:CondicionIVAReceptorId>6<\/ar:CondicionIVAReceptorId>/);
  assert.match(xml, /<ar:Concepto>2<\/ar:Concepto>/);
  assert.match(xml, /<ar:FchServDesde>20261001<\/ar:FchServDesde>/);
  assert.match(xml, /<ar:FchServHasta>20261031<\/ar:FchServHasta>/);
  assert.match(xml, /<ar:FchVtoPago>20261005<\/ar:FchVtoPago>/);
  // Nada sin prefijo.
  assert.doesNotMatch(xml, /<DocTipo>/);
  assert.doesNotMatch(xml, /<FECAEDetRequest>/);
});

await prueba('FECAESolicitar (individual): DocTipo 99, DocNro 0, CondicionIVAReceptorId Consumidor Final (5)', () => {
  const xml = construirFECAESolicitarRequest(authFake, '20111111112', 3, 16, inputIndividual);
  assert.match(xml, /<ar:DocTipo>99<\/ar:DocTipo>/);
  assert.match(xml, /<ar:DocNro>0<\/ar:DocNro>/);
  assert.match(xml, /<ar:CondicionIVAReceptorId>5<\/ar:CondicionIVAReceptorId>/);
});

await prueba('FECAESolicitar: Factura C siempre ImpTotal = ImpNeto, ImpIVA 0, MonId PES, MonCotiz 1', () => {
  const xml = construirFECAESolicitarRequest(authFake, '20111111112', 3, 17, inputOrg);
  assert.match(xml, /<ar:ImpTotal>15000.5<\/ar:ImpTotal>/);
  assert.match(xml, /<ar:ImpNeto>15000.5<\/ar:ImpNeto>/);
  assert.match(xml, /<ar:ImpIVA>0<\/ar:ImpIVA>/);
  assert.match(xml, /<ar:MonId>PES<\/ar:MonId>/);
  assert.match(xml, /<ar:MonCotiz>1<\/ar:MonCotiz>/);
});

await prueba('FECAESolicitar: el orden de FECAEDetRequest sigue EXACTO al xsd:sequence del WSDL (ImpOpEx, ImpTrib, ImpIVA)', () => {
  const xml = construirFECAESolicitarRequest(authFake, '20111111112', 3, 18, inputOrg);
  const posImpOpEx = xml.indexOf('<ar:ImpOpEx>');
  const posImpTrib = xml.indexOf('<ar:ImpTrib>');
  const posImpIVA = xml.indexOf('<ar:ImpIVA>');
  assert.ok(posImpOpEx > 0 && posImpTrib > posImpOpEx && posImpIVA > posImpTrib, 'orden real del WSDL: ImpOpEx < ImpTrib < ImpIVA');
});

// ─────────────────────────────────────────────────────────────
// Parseo de respuestas (fixtures reales de homologación y del manual WSFEv1)
// ─────────────────────────────────────────────────────────────

await prueba('parsearFeCompUltimoAutorizadoResponse: lee CbteNro sin Errors', () => {
  const xml = `<FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><CbteNro>42</CbteNro></FECompUltimoAutorizadoResult>`;
  const parseado = parsearFeCompUltimoAutorizadoResponse(xml);
  assert.equal(parseado.cbteNro, 42);
  assert.deepEqual(parseado.errores, []);
});

// Fixture REAL: homologación, PtoVta 1/CbteTipo 11, pedido SIN namespace
// calificar (el defecto que esta tarea arregló) — T8c lo reprodujo en vivo.
const FIXTURE_ULTIMO_AUTORIZADO_ERROR_REAL =
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soap:Body><FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>` +
  `<PtoVta>0</PtoVta><CbteTipo>0</CbteTipo><CbteNro>0</CbteNro>` +
  `<Errors><Err><Code>500</Code><Msg>Campo Auth no fue ingresado o esta mal formado.</Msg></Err></Errors>` +
  `</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`;

await prueba('parsearFeCompUltimoAutorizadoResponse: un <Errors> llega como código+mensaje (fixture real de homologación)', () => {
  const parseado = parsearFeCompUltimoAutorizadoResponse(FIXTURE_ULTIMO_AUTORIZADO_ERROR_REAL);
  assert.deepEqual(parseado.errores, [{ code: '500', message: 'Campo Auth no fue ingresado o esta mal formado.' }]);
});

const FIXTURE_EXITO = `<FECAESolicitarResponse><FECAESolicitarResult>
  <FeCabResp><Cuit>20111111112</Cuit><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><FchProceso>20261015</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado></FeCabResp>
  <FeDetResp><FECAEDetResponse><Concepto>2</Concepto><DocTipo>80</DocTipo><DocNro>20123456786</DocNro><CbteDesde>18</CbteDesde><CbteHasta>18</CbteHasta><Resultado>A</Resultado><CAE>71234567890123</CAE><CAEFchVto>20261025</CAEFchVto></FECAEDetResponse></FeDetResp>
</FECAESolicitarResult></FECAESolicitarResponse>`;

await prueba('parsearFECAESolicitarResponse: éxito (Resultado A) trae CAE y CAEFchVto, sin errores ni observaciones', () => {
  const parseado = parsearFECAESolicitarResponse(FIXTURE_EXITO);
  assert.equal(parseado.resultado, 'A');
  assert.equal(parseado.cae, '71234567890123');
  assert.equal(parseado.caeFchVto, '20261025');
  assert.deepEqual(parseado.errores, []);
  assert.deepEqual(parseado.observaciones, []);
});

const FIXTURE_OBSERVADO = `<FECAESolicitarResponse><FECAESolicitarResult>
  <FeCabResp><Resultado>R</Resultado></FeCabResp>
  <FeDetResp><FECAEDetResponse><Resultado>R</Resultado>
    <Observaciones><Obs><Code>10048</Code><Msg>Falta informar CondicionIVAReceptorId</Msg></Obs></Observaciones>
  </FECAEDetResponse></FeDetResp>
</FECAESolicitarResult></FECAESolicitarResponse>`;

await prueba('parsearFECAESolicitarResponse: rechazo observado (Resultado R) trae Observaciones y ningún CAE', () => {
  const parseado = parsearFECAESolicitarResponse(FIXTURE_OBSERVADO);
  assert.equal(parseado.resultado, 'R');
  assert.equal(parseado.cae, null);
  assert.deepEqual(parseado.observaciones, ['Falta informar CondicionIVAReceptorId']);
});

const FIXTURE_ERROR_SOAP = `<FECAESolicitarResponse><FECAESolicitarResult>
  <FeCabResp><Resultado>R</Resultado></FeCabResp>
  <FeDetResp><FECAEDetResponse><Resultado>R</Resultado></FECAEDetResponse></FeDetResp>
</FECAESolicitarResult><Errors><Err><Code>600</Code><Msg>Coe no validado para WSFEv1</Msg></Err></Errors></FECAESolicitarResponse>`;

await prueba('parsearFECAESolicitarResponse: un <Errors> a nivel SOAP se lee con código+mensaje, aparte de las Observaciones', () => {
  const parseado = parsearFECAESolicitarResponse(FIXTURE_ERROR_SOAP);
  assert.deepEqual(parseado.errores, [{ code: '600', message: 'Coe no validado para WSFEv1' }]);
});

// ─────────────────────────────────────────────────────────────
// WSAA — TRA, expiración de token, fault alreadyAuthenticated
// ─────────────────────────────────────────────────────────────

await prueba('construirTRA: generationTime antes de "ahora", expirationTime después, con el service pedido', () => {
  const ahora = new Date('2026-10-15T12:00:00Z');
  const tra = construirTRA('wsfe', ahora);
  assert.match(tra, /<service>wsfe<\/service>/);
  const generationTime = new Date(tra.match(/<generationTime>([^<]+)<\/generationTime>/)![1]);
  const expirationTime = new Date(tra.match(/<expirationTime>([^<]+)<\/expirationTime>/)![1]);
  assert.ok(generationTime.getTime() < ahora.getTime(), 'generationTime debe ser antes de ahora');
  assert.ok(expirationTime.getTime() > ahora.getTime(), 'expirationTime debe ser después de ahora');
});

await prueba('parsearLoginTicketResponse: lee token/sign/expirationTime', () => {
  const xml = `<loginTicketResponse><header><expirationTime>2026-10-15T22:00:00.000-03:00</expirationTime></header><credentials><token>abc</token><sign>def</sign></credentials></loginTicketResponse>`;
  const ticket = parsearLoginTicketResponse(xml);
  assert.equal(ticket.token, 'abc');
  assert.equal(ticket.sign, 'def');
  assert.ok(!Number.isNaN(ticket.expirationTime.getTime()));
});

await prueba('ticketVigente: todavía vigente bien antes de vencer, no vigente dentro del margen de renovación', () => {
  const ticket: LoginTicket = { token: 't', sign: 's', expirationTime: new Date('2026-10-15T12:00:00Z') };
  assert.equal(ticketVigente(ticket, new Date('2026-10-15T11:00:00Z')), true, 'falta 1h: vigente');
  assert.equal(ticketVigente(ticket, new Date('2026-10-15T11:55:00Z')), false, 'faltan 5min (< margen de 10min): hay que renovar');
  assert.equal(ticketVigente(ticket, new Date('2026-10-15T12:30:00Z')), false, 'ya venció');
});

await prueba('estimarLiberacion: con un TA guardado usa SU expirationTime real; sin nada guardado, ahora + 12hs (cota segura)', () => {
  const ahora = new Date('2026-10-15T12:00:00Z');
  const guardado: LoginTicket = { token: 't', sign: 's', expirationTime: new Date('2026-10-15T14:00:00Z') };
  assert.equal(estimarLiberacion(guardado, ahora).getTime(), guardado.expirationTime.getTime());
  assert.equal(estimarLiberacion(null, ahora).getTime(), ahora.getTime() + 12 * 60 * 60 * 1000);
});

// Fixture REAL: SOAP Fault que WSAA homologación devolvió en vivo (T8c) al
// loguear con un TA ya vigente de un login anterior en la misma sesión.
const FIXTURE_FAULT_ALREADY_AUTHENTICATED =
  `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soapenv:Body><soapenv:Fault><faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:coe.alreadyAuthenticated</faultcode>` +
  `<faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring>` +
  `<detail><ns2:exceptionName xmlns:ns2="http://xml.apache.org/axis/">gov.afip.desein.dvadac.sua.view.wsaa.LoginFault</ns2:exceptionName>` +
  `<ns3:hostname xmlns:ns3="http://xml.apache.org/axis/">wsaaext1.homo.afip.gov.ar</ns3:hostname></detail></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;

await prueba('fixture real de alreadyAuthenticated: faultstring se puede leer con extraerTag (regresión del parseo)', async () => {
  const { extraerTag } = await import('../src/lib/billing/facturador/xml.ts');
  assert.equal(extraerTag(FIXTURE_FAULT_ALREADY_AUTHENTICATED, 'faultstring'), 'El CEE ya posee un TA valido para el acceso al WSN solicitado');
});

// ─────────────────────────────────────────────────────────────
// obtenerTicketVigente — persistencia, lock y alreadyAuthenticated (T8c)
// ─────────────────────────────────────────────────────────────

await prueba('obtenerTicketVigente: sin nada guardado, loguea y persiste', async () => {
  const store = crearTicketStoreEnMemoria();
  let logins = 0;
  const loginFalso = async () => {
    logins++;
    return { token: 'T1', sign: 'S1', expirationTime: new Date(Date.now() + 60 * 60 * 1000) };
  };
  const ticket = await obtenerTicketVigente(configFake, store, loginFalso);
  assert.equal(ticket.token, 'T1');
  assert.equal(logins, 1);
  const guardado = await store.leer(configFake.cuit, configFake.entorno, 'wsfe');
  assert.equal(guardado?.token, 'T1');
});

await prueba('obtenerTicketVigente: con un TA vigente guardado, NO loguea de nuevo', async () => {
  const store = crearTicketStoreEnMemoria();
  await store.guardar(configFake.cuit, configFake.entorno, 'wsfe', { token: 'VIEJO', sign: 'S', expirationTime: new Date(Date.now() + 60 * 60 * 1000) });
  let logins = 0;
  const loginFalso = async () => {
    logins++;
    throw new Error('no debería loguear: ya hay un TA vigente guardado');
  };
  const ticket = await obtenerTicketVigente(configFake, store, loginFalso);
  assert.equal(ticket.token, 'VIEJO');
  assert.equal(logins, 0);
});

await prueba('obtenerTicketVigente: con un TA vencido guardado, loguea y reemplaza', async () => {
  const store = crearTicketStoreEnMemoria();
  await store.guardar(configFake.cuit, configFake.entorno, 'wsfe', { token: 'VENCIDO', sign: 'S', expirationTime: new Date(Date.now() - 1000) });
  let logins = 0;
  const loginFalso = async () => {
    logins++;
    return { token: 'NUEVO', sign: 'S2', expirationTime: new Date(Date.now() + 60 * 60 * 1000) };
  };
  const ticket = await obtenerTicketVigente(configFake, store, loginFalso);
  assert.equal(ticket.token, 'NUEVO');
  assert.equal(logins, 1);
});

await prueba('obtenerTicketVigente: dos llamadas concurrentes serializan con withLock (un solo login)', async () => {
  const store = crearTicketStoreEnMemoria();
  let logins = 0;
  const loginFalso = async () => {
    logins++;
    await new Promise((resolve) => setTimeout(resolve, 20)); // simula latencia de red.
    return { token: `T-${logins}`, sign: 'S', expirationTime: new Date(Date.now() + 60 * 60 * 1000) };
  };
  const [a, b] = await Promise.all([obtenerTicketVigente(configFake, store, loginFalso), obtenerTicketVigente(configFake, store, loginFalso)]);
  assert.equal(logins, 1, 'el lock tiene que serializar: la segunda llamada encuentra el TA que ya guardó la primera');
  assert.equal(a.token, b.token);
});

await prueba('obtenerTicketVigente: alreadyAuthenticated sin nada guardado da el mensaje con la cota de 12hs', async () => {
  const store = crearTicketStoreEnMemoria();
  const loginFalso = async () => {
    throw new WsaaAlreadyAuthenticatedError('El CEE ya posee un TA valido para el acceso al WSN solicitado');
  };
  await assert.rejects(
    () => obtenerTicketVigente(configFake, store, loginFalso),
    (error: unknown) => {
      assert.ok(error instanceof WsaaAlreadyAuthenticatedError);
      assert.match((error as Error).message, /ARCA tiene un acceso vigente que Kodu no guardó/);
      assert.match((error as Error).message, /se libera como máximo a las \d{2}:\d{2}/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────────
// Firma CMS (openssl), con un certificado autofirmado DE PRUEBA
// ─────────────────────────────────────────────────────────────

await prueba('firmarTRA: firma CMS con un certificado autofirmado de prueba y openssl la verifica', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kodu-arca-test-'));
  try {
    const certPath = join(dir, 'cert.pem');
    const keyPath = join(dir, 'key.pem');
    const { code: codeGen, stderr: stderrGen } = await ejecutar('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=kodu-e2e-test',
    ]);
    assert.equal(codeGen, 0, `no se pudo generar el certificado de prueba: ${stderrGen}`);

    const tra = construirTRA('wsfe', new Date());
    const cmsBase64 = await firmarTRA(tra, certPath, keyPath);
    assert.ok(cmsBase64.length > 0, 'la firma CMS no puede quedar vacía');

    const cmsPath = join(dir, 'tra.cms');
    await writeFile(cmsPath, Buffer.from(cmsBase64, 'base64'));

    const { code: codeVerify, stderr: stderrVerify } = await ejecutar('openssl', [
      'cms',
      '-verify',
      '-noverify',
      '-in',
      cmsPath,
      '-inform',
      'DER',
      '-out',
      join(dir, 'contenido-verificado.xml'),
    ]);
    assert.equal(codeVerify, 0, `openssl cms -verify debería aceptar la firma: ${stderrVerify}`);

    const contenidoVerificado = await readFile(join(dir, 'contenido-verificado.xml'), 'utf8');
    assert.equal(contenidoVerificado, tra, 'el contenido firmado tiene que ser EXACTAMENTE el TRA original');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
} else {
  console.log('\nTodas las pruebas de unidad-facturador pasaron.');
}
