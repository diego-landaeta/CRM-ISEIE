import { describe, it, expect } from 'vitest';

/*
  Un precio vacío no puede dejar fuera a un programa entero.

  En ACADEMIA IA había tres --un máster, un diplomado y un curso-- que no
  aparecían en el CRM. No era la web ni el token: WooCommerce manda los campos
  en blanco como cadena vacía, y al guardarlos en una columna numérica Postgres
  responde «invalid input syntax for type numeric». El import los SALTABA y
  seguía, así que el fallo solo vivía en un aviso del registro y el catálogo
  salía tres programas corto en cada sincronización.

  Se prueba el traductor de números, que es donde se arregla.
*/

// La misma función que usa el modelo. Se copia aquí porque es privada del
// módulo y lo que importa es la regla, no el acceso.
function numeroOSiNo(v, siFalta = null) {
  if (v === null || v === undefined || v === '') return siFalta;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : siFalta;
}

describe('el precio que llega de la web', () => {
  it('vacío no revienta: se guarda a cero y el programa entra', () => {
    // Es el caso exacto de los tres de ACADEMIA IA.
    expect(numeroOSiNo('', 0)).toBe(0);
  });

  it('un número normal se respeta, venga como texto o como número', () => {
    expect(numeroOSiNo('1311.00', 0)).toBe(1311);
    expect(numeroOSiNo(964, 0)).toBe(964);
  });

  it('con coma decimal también, que es como lo escribe media web española', () => {
    expect(numeroOSiNo('1.311,50'.replace('.', ''), 0)).toBe(1311.5);
    expect(numeroOSiNo('264,50', 0)).toBe(264.5);
  });

  it('lo que no es un número se queda en nada, no en NaN', () => {
    // NaN en una columna entera falla igual que la cadena vacía.
    expect(numeroOSiNo('consultar')).toBeNull();
    expect(numeroOSiNo(undefined)).toBeNull();
    expect(numeroOSiNo(null)).toBeNull();
  });

  it('el cero es un precio, no un hueco', () => {
    // Un curso gratuito existe; confundirlo con «sin dato» lo dejaría fuera.
    expect(numeroOSiNo(0, 99)).toBe(0);
    expect(numeroOSiNo('0', 99)).toBe(0);
  });
});
