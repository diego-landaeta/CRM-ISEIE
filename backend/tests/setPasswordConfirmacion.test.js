import { describe, it, expect } from 'vitest';
import { setPasswordSchema } from '../src/modules/auth/auth.validation.js';

/**
 * «Establece tu contraseña» daba «Required» con cualquier contraseña en ISEIE:
 * la pantalla no mandaba la confirmación y el servidor la exigía. Tras ocho
 * intentos saltaba «Demasiados intentos. Intenta de nuevo en 15 minutos»
 * (02/10, la invitación de Vlad). Ahora la confirmación es opcional en el
 * servidor; si viene, tiene que coincidir.
 */

const TOKEN = 'a'.repeat(64);

describe('poner la contraseña desde la invitación', () => {
  it('sin confirmación: vale', () => {
    expect(setPasswordSchema.safeParse({ token: TOKEN, password: 'Vlad12345' }).success).toBe(true);
  });

  it('con confirmación igual: vale', () => {
    expect(setPasswordSchema.safeParse({ token: TOKEN, password: 'Vlad12345', confirmPassword: 'Vlad12345' }).success).toBe(true);
  });

  it('con confirmación distinta: no', () => {
    const r = setPasswordSchema.safeParse({ token: TOKEN, password: 'Vlad12345', confirmPassword: 'Otra12345' });
    expect(r.success).toBe(false);
    expect(r.error.issues[0].message).toMatch(/no coinciden/);
  });

  it('las reglas de la contraseña siguen', () => {
    expect(setPasswordSchema.safeParse({ token: TOKEN, password: 'corta' }).success).toBe(false);
    expect(setPasswordSchema.safeParse({ token: TOKEN, password: 'sinmayuscula1' }).success).toBe(false);
  });

  it('sin token: no', () => {
    expect(setPasswordSchema.safeParse({ password: 'Vlad12345' }).success).toBe(false);
  });
});
