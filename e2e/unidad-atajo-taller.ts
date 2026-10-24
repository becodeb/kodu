import assert from 'node:assert/strict';
import { rutaDeInvitacionDelTaller } from '../src/lib/taller/atajo.ts';

/**
 * Pruebas unitarias de src/lib/taller/atajo.ts (/taller): de qué valores de
 * `TALLER_INVITE_URL` sale una ruta de invitación, y que nunca sale un
 * destino fuera del sitio.
 *
 * Ejecutar con: npx tsx e2e/unidad-atajo-taller.ts
 */

let fallas = 0;

async function prueba(nombre: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✔ ${nombre}`);
  } catch (error) {
    fallas++;
    console.error(`✖ ${nombre}`);
    console.error(`  ${(error as Error).message}`);
  }
}

const TOKEN = 'Ab3_token-de-prueba_9Zx';

await prueba('enlace completo de /org -> ruta relativa de la invitación', () => {
  assert.equal(rutaDeInvitacionDelTaller(`https://kodu.becode.com.ar/invitacion/${TOKEN}`), `/invitacion/${TOKEN}`);
});

await prueba('token solo, con espacios alrededor -> misma ruta', () => {
  assert.equal(rutaDeInvitacionDelTaller(`  ${TOKEN}\n`), `/invitacion/${TOKEN}`);
});

await prueba('barra final, query o hash no cambian el token', () => {
  assert.equal(rutaDeInvitacionDelTaller(`https://kodu.becode.com.ar/invitacion/${TOKEN}/`), `/invitacion/${TOKEN}`);
  assert.equal(rutaDeInvitacionDelTaller(`https://kodu.becode.com.ar/invitacion/${TOKEN}?x=1`), `/invitacion/${TOKEN}`);
  assert.equal(rutaDeInvitacionDelTaller(`https://kodu.becode.com.ar/invitacion/${TOKEN}#a`), `/invitacion/${TOKEN}`);
});

await prueba('otro dominio: se usa sólo el token, nunca el dominio ajeno', () => {
  assert.equal(rutaDeInvitacionDelTaller(`https://evil.example/invitacion/${TOKEN}`), `/invitacion/${TOKEN}`);
});

await prueba('vacío o sin forma de invitación -> null (la página vuelve al inicio)', () => {
  assert.equal(rutaDeInvitacionDelTaller(''), null);
  assert.equal(rutaDeInvitacionDelTaller('   '), null);
  assert.equal(rutaDeInvitacionDelTaller('https://evil.example/login'), null);
  assert.equal(rutaDeInvitacionDelTaller('https://kodu.becode.com.ar/invitacion/'), null);
  assert.equal(rutaDeInvitacionDelTaller('https://kodu.becode.com.ar/invitacion/a b'), null);
  assert.equal(rutaDeInvitacionDelTaller('//evil.example'), null);
});

if (fallas > 0) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodo OK.');
