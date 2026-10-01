import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  construirFECAESolicitarRequest,
  construirFeCompUltimoAutorizadoRequest,
  construirTRA,
  firmarTRA,
  parsearFECAESolicitarResponse,
  parsearFeCompUltimoAutorizadoResponse,
  parsearLoginTicketResponse,
  ticketVigente,
  type LoginTicket,
} from '../src/lib/billing/facturador/arca.ts';
import { yyyymmdd } from '../src/lib/billing/facturador/xml.ts';
import type { FacturaInput } from '../src/lib/billing/facturador/tipos.ts';

/**
 * odd/tasks/planes-y-cobros.md (T8): pruebas unitarias, offline, del
 * adaptador ARCA — NUNCA pega contra `wsaahomo.afip.gov.ar` ni contra WSFEv1
 * real (prohibido en esta tarea: no hay certificados reales en este
 * worktree). Lo que se prueba:
 *
 * - El XML del pedido de WSFEv1 (`FECAESolicitar`) para un receptor
 *   institucional (CUIT + condición IVA) y uno individual (consumidor
 *   final).
 * - Que para Factura C `ImpTotal === ImpNeto` e `ImpIVA = 0`.
 * - El formato de fecha `yyyymmdd` en hora de Argentina.
 * - El parseo de una respuesta de éxito y de rechazo/observada de
 *   `FECAESolicitar` (fixtures armados a mano siguiendo la forma documentada
 *   del manual del desarrollador de WSFEv1 — ver el informe de T8).
 * - La generación del TRA de WSAA y el manejo de expiración del token.
 * - La firma CMS con `openssl cms -sign` contra un certificado autofirmado
 *   generado EN LA PRUEBA (nunca un certificado real), verificada con
 *   `openssl cms -verify -noverify`.
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

// ─────────────────────────────────────────────────────────────
// yyyymmdd — hora de Argentina (UTC-3 fijo)
// ─────────────────────────────────────────────────────────────

await prueba('yyyymmdd: usa el día en hora de Argentina, no en UTC', () => {
  // 2026-10-15T02:00:00Z son las 23:00 del 14/10 en Argentina (UTC-3).
  assert.equal(yyyymmdd(new Date('2026-10-15T02:00:00Z')), '20261014');
  assert.equal(yyyymmdd(new Date('2026-10-15T12:00:00Z')), '20261015');
});

// ─────────────────────────────────────────────────────────────
// FECAESolicitar — pedido (institucional / individual)
// ─────────────────────────────────────────────────────────────

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

await prueba('FECAESolicitar (org): DocTipo 80, CondicionIVAReceptorId de MONOTRIBUTO (6), Concepto 2', () => {
  const xml = construirFECAESolicitarRequest(authFake, '20111111112', 3, 15, inputOrg);
  assert.match(xml, /<DocTipo>80<\/DocTipo>/);
  assert.match(xml, /<DocNro>20123456786<\/DocNro>/);
  assert.match(xml, /<CondicionIVAReceptorId>6<\/CondicionIVAReceptorId>/);
  assert.match(xml, /<Concepto>2<\/Concepto>/);
  assert.match(xml, /<FchServDesde>20261001<\/FchServDesde>/);
  assert.match(xml, /<FchServHasta>20261031<\/FchServHasta>/);
  assert.match(xml, /<FchVtoPago>20261005<\/FchVtoPago>/);
});

await prueba('FECAESolicitar (individual): DocTipo 99, DocNro 0, CondicionIVAReceptorId Consumidor Final (5)', () => {
  const xml = construirFECAESolicitarRequest(authFake, '20111111112', 3, 16, inputIndividual);
  assert.match(xml, /<DocTipo>99<\/DocTipo>/);
  assert.match(xml, /<DocNro>0<\/DocNro>/);
  assert.match(xml, /<CondicionIVAReceptorId>5<\/CondicionIVAReceptorId>/);
});

await prueba('FECAESolicitar: Factura C siempre ImpTotal = ImpNeto, ImpIVA 0, MonId PES, MonCotiz 1', () => {
  const xml = construirFECAESolicitarRequest(authFake, '20111111112', 3, 17, inputOrg);
  assert.match(xml, /<ImpTotal>15000.5<\/ImpTotal>/);
  assert.match(xml, /<ImpNeto>15000.5<\/ImpNeto>/);
  assert.match(xml, /<ImpIVA>0<\/ImpIVA>/);
  assert.match(xml, /<MonId>PES<\/MonId>/);
  assert.match(xml, /<MonCotiz>1<\/MonCotiz>/);
});

await prueba('FECompUltimoAutorizado: pide el punto de venta y CbteTipo 11 (Factura C)', () => {
  const xml = construirFeCompUltimoAutorizadoRequest(authFake, '20111111112', 3);
  assert.match(xml, /<PtoVta>3<\/PtoVta>/);
  assert.match(xml, /<CbteTipo>11<\/CbteTipo>/);
});

// ─────────────────────────────────────────────────────────────
// Parseo de respuestas (fixtures según el manual del desarrollador WSFEv1)
// ─────────────────────────────────────────────────────────────

await prueba('parsearFeCompUltimoAutorizadoResponse: lee CbteNro', () => {
  const xml = `<FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>11</CbteTipo><CbteNro>42</CbteNro></FECompUltimoAutorizadoResult>`;
  assert.equal(parsearFeCompUltimoAutorizadoResponse(xml), 42);
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

await prueba('parsearFECAESolicitarResponse: un <Errors> a nivel SOAP se lee aparte de las Observaciones', () => {
  const parseado = parsearFECAESolicitarResponse(FIXTURE_ERROR_SOAP);
  assert.deepEqual(parseado.errores, ['Coe no validado para WSFEv1']);
});

// ─────────────────────────────────────────────────────────────
// WSAA — TRA, expiración de token
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
