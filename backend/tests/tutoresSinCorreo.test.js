import { describe, it, expect } from 'vitest';
import * as ctrl from '../src/modules/tutores/tutor.controller.js';
import { NO_ESCRIBIR_A_TUTORES } from '../src/shared/config/frenoTutores.js';

/**
 * Con el freno de correos a tutores puesto (15/09), nada del alta puede
 * depender de un correo.
 *
 * Diego, 01/10, tras dar de alta a un tutor de prueba y ver «Le llega un correo
 * con el enlace para poner su contraseña»: «esa opción para tutores no debe de
 * mandarse ni hacerse». El correo no salía —el freno funcionaba—, pero la
 * pantalla lo prometía, y un alta sin contraseña dejaba al tutor sin forma de
 * entrar.
 */

async function llamar(handler, req) {
  const res = { cuerpo: null, codigo: 200 };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (c) => { res.cuerpo = c; return res; };
  let error = null;
  await handler({ headers: {}, ip: '127.0.0.1', query: {}, params: {}, ...req }, res, (e) => { error = e; });
  return { res, error };
}

const ADMIN = { userId: 1, role: 'admin' };

describe('con el freno de correos a tutores', () => {
  it('el freno sigue puesto (si se quita, esta prueba hay que revisarla)', () => {
    expect(NO_ESCRIBIR_A_TUTORES).toBe(true);
  });

  it('el alta sin contraseña se rechaza antes de crear a nadie', async () => {
    const { error } = await llamar(ctrl.alta, {
      user: ADMIN,
      body: { nombre: 'Tutor sin clave', email: 'sin.clave@test.local', projectIds: [1] },
    });
    expect(error?.code).toBe('CONTRASENA_OBLIGATORIA');
    expect(error?.statusCode).toBe(400);
  });

  it('los ajustes le dicen a la pantalla que no se escribe a los tutores', async () => {
    const { res, error } = await llamar(ctrl.ajustes, { user: ADMIN });
    expect(error).toBeNull();
    expect(res.cuerpo.data.correos_a_tutores).toBe(false);
  });
});
