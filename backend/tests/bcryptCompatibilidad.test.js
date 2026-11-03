import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';

/**
 * #628: bcrypt pasa de la 5 a la 6 (la 5 traía `tar` crítico por
 * @mapbox/node-pre-gyp). Todas las contraseñas de la base se guardaron con la
 * 5 y cost 12: la 6 tiene que seguir dándolas por buenas, o nadie entra.
 *
 * Este hash se generó con bcrypt 5.1.1 (cost 12) antes de subir de versión.
 * La contraseña es de pega y solo existe en esta prueba.
 */
const HASH_DE_BCRYPT_5 = '$2b$12$L0F9XTgxBtoJfpemb8zP3egFh2IgtPFbH6D4Ma0gugpJM0WW7qYdy';
const CONTRASENA = 'Prueba-628-contraseña';

describe('bcrypt: hashes creados con la versión 5', () => {
  it('la contraseña correcta sigue entrando', async () => {
    expect(await bcrypt.compare(CONTRASENA, HASH_DE_BCRYPT_5)).toBe(true);
  });

  it('una contraseña equivocada no entra', async () => {
    expect(await bcrypt.compare('otra-cosa', HASH_DE_BCRYPT_5)).toBe(false);
  });

  it('el cost del hash viejo se sigue leyendo como 12', () => {
    expect(bcrypt.getRounds(HASH_DE_BCRYPT_5)).toBe(12);
  });

  it('los hashes nuevos salen con el mismo formato y cost 12', async () => {
    const nuevo = await bcrypt.hash(CONTRASENA, 12);
    expect(nuevo).toMatch(/^\$2b\$12\$/);
    expect(await bcrypt.compare(CONTRASENA, nuevo)).toBe(true);
  });
});
