/**
 * odd/tasks/planes-y-cobros.md (T4): validación del CUIT institucional
 * (`OrganizationLicense.cuit`), exigido para poder contratar. Módulo PURO.
 *
 * Algoritmo estándar de dígito verificador de CUIT/CUIL argentino: los
 * primeros 10 dígitos se multiplican por la serie [5,4,3,2,7,6,5,4,3,2], se
 * suma, se calcula `11 - (suma % 11)` y eso tiene que dar el 11º dígito
 * (con los casos especiales 11→0 y 10→inválido: no existe un CUIT cuyo
 * dígito verificador dé 10).
 */

const MULTIPLICADORES = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Deja sólo dígitos (acepta "20-12345678-3", "20123456783", con espacios). */
function soloDigitos(cuit: string): string {
  return cuit.replace(/\D/g, '');
}

export function esCuitValido(cuitCrudo: string): boolean {
  const digitos = soloDigitos(cuitCrudo);
  if (digitos.length !== 11) return false;

  const numeros = digitos.split('').map(Number);
  const suma = numeros.slice(0, 10).reduce((acum, n, i) => acum + n * MULTIPLICADORES[i], 0);
  const resto = suma % 11;
  const verificadorEsperado = 11 - resto;

  const verificador = verificadorEsperado === 11 ? 0 : verificadorEsperado === 10 ? -1 : verificadorEsperado;
  if (verificador === -1) return false; // nunca existe: CUIT mal tipeado.

  return verificador === numeros[10];
}

/** Normaliza a "XX-XXXXXXXX-X" para guardar siempre el mismo formato. */
export function formatearCuit(cuitCrudo: string): string {
  const digitos = soloDigitos(cuitCrudo);
  if (digitos.length !== 11) return cuitCrudo.trim();
  return `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos.slice(10)}`;
}
