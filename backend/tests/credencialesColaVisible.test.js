import { describe, it, expect } from 'vitest';
import { secretoVisible } from '../src/modules/credentials/credentials.model.js';

/**
 * Lo que se enseña de una clave guardada son sus cuatro últimos caracteres.
 *
 * Visto en la pantalla de Claves (21/10): Moodle guarda un JSON
 * ({"url":…,"token":…}) y la columna Valor enseñaba `a9"}`, o sea, comillas y una
 * llave, no el token. Para un valor así se enseña la cola del TOKEN.
 */
describe('secretoVisible: de qué se enseñan los cuatro ultimos caracteres', () => {
  it('una clave normal se enseña tal cual', () => {
    expect(secretoVisible('xkeysib-abcdef1234').slice(-4)).toBe('1234');
  });

  it('un JSON con token enseña la cola del token, no comillas ni llaves', () => {
    const valor = JSON.stringify({ url: 'https://campus.ejemplo.com', token: '0123456789abcdef0123456789abcd9z' });
    expect(secretoVisible(valor).slice(-4)).toBe('cd9z');
    expect(secretoVisible(valor).slice(-4)).not.toMatch(/["}]/);
  });

  it('un JSON sin token, o roto, o con token muy corto, vale el valor entero', () => {
    expect(secretoVisible('{"url":"https://x.test"}')).toBe('{"url":"https://x.test"}');
    expect(secretoVisible('{no es json')).toBe('{no es json');
    expect(secretoVisible('{"token":"abc"}')).toBe('{"token":"abc"}');
  });
});
