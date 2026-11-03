import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «He olvidado la contraseña» (#37).
 *
 * Lo que se fija aqui no es que el correo salga —eso se ve— sino la propiedad
 * que el ticket pone por escrito y que NO se ve mirando la pantalla:
 *
 *   «Que no diga si el correo existe o no — si lo dice, sirve para averiguar
 *    quien trabaja aqui.»
 *
 * Es una regla facil de romper sin querer y de la que nadie se entera: basta
 * que alguien añada un 404 «para que el usuario sepa que se equivoco», y la
 * pantalla de entrar pasa a ser un listado de empleados a base de probar
 * correos. Por eso la comprobacion compara las DOS respuestas enteras, no que
 * cada una sea 200 por su cuenta.
 */

const modelo = {
  findActiveUserByEmail: vi.fn(),
  setRecoveryToken: vi.fn(async () => {}),
  logActivity: vi.fn(async () => {}),
  // Para poner la contraseña con el enlace (setPassword).
  findUserBySetPasswordToken: vi.fn(),
  updatePassword: vi.fn(async () => {}),
  revokeAllUserTokens: vi.fn(async () => {}),
};
vi.mock('../src/modules/auth/auth.model.js', () => modelo);

const enviado = vi.fn(async () => ({ sent: true }));
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendPasswordResetEmail: (...a) => enviado(...a),
  sendWelcomeUserEmail: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('../src/modules/permissions/permissions.service.js', () => ({
  buildPermissionsMap: vi.fn(), resolveUserView: vi.fn(),
}));

const ctrl = await import('../src/modules/auth/auth.controller.js');

function fingirRes() {
  const res = { codigo: 200, cuerpo: null };
  res.status = (c) => { res.codigo = c; return res; };
  res.json = (c) => { res.cuerpo = c; return res; };
  return res;
}

async function pedirRecuperacion(email) {
  const res = fingirRes();
  let error = null;
  await ctrl.forgotPassword({ body: { email } }, res, (e) => { error = e; });
  // El trabajo va detras de la respuesta (para que no delate la cuenta por el
  // tiempo): se deja que termine antes de mirar que ha pasado.
  await new Promise((r) => setTimeout(r, 0));
  return { res, error };
}

const LAURA = { id: 4, email: 'laura@empresa.com', nombre: 'Laura Garcia' };

beforeEach(() => {
  modelo.findActiveUserByEmail.mockReset();
  modelo.setRecoveryToken.mockClear();
  modelo.logActivity.mockClear();
  modelo.findUserBySetPasswordToken.mockReset();
  modelo.updatePassword.mockClear();
  modelo.revokeAllUserTokens.mockClear();
  enviado.mockClear();
  enviado.mockResolvedValue({ sent: true });
});

describe('no delata quien tiene cuenta', () => {
  it('contesta EXACTAMENTE lo mismo exista el correo o no', async () => {
    modelo.findActiveUserByEmail.mockResolvedValue(LAURA);
    const conCuenta = await pedirRecuperacion('laura@empresa.com');

    modelo.findActiveUserByEmail.mockResolvedValue(null);
    const sinCuenta = await pedirRecuperacion('nadie@ejemplo.com');

    expect(conCuenta.res.codigo).toBe(sinCuenta.res.codigo);
    expect(conCuenta.res.cuerpo).toEqual(sinCuenta.res.cuerpo);
    expect(conCuenta.error).toBeNull();
    expect(sinCuenta.error).toBeNull();
  });

  it('con un correo desconocido no se toca la base ni se manda nada', async () => {
    modelo.findActiveUserByEmail.mockResolvedValue(null);
    await pedirRecuperacion('nadie@ejemplo.com');
    expect(modelo.setRecoveryToken).not.toHaveBeenCalled();
    expect(enviado).not.toHaveBeenCalled();
  });

  it('si el envio del correo falla, la respuesta NO cambia', async () => {
    // Un error visible aqui distingue un correo real de uno que no lo es
    // igual de bien que un 404.
    modelo.findActiveUserByEmail.mockResolvedValue(LAURA);
    enviado.mockRejectedValue(new Error('Brevo caido'));
    const { res, error } = await pedirRecuperacion('laura@empresa.com');
    expect(error).toBeNull();
    expect(res.codigo).toBe(200);
    expect(res.cuerpo.success).toBe(true);
  });

  it('la respuesta NO espera al trabajo: el tiempo no delata la cuenta', async () => {
    // Si buscar al usuario tardara, o no acabara nunca, la respuesta sale igual.
    // Con un correo que existe se hace mas trabajo que con uno que no, y esperar
    // a ese trabajo seria un cronometro para saber quien tiene cuenta.
    modelo.findActiveUserByEmail.mockReturnValue(new Promise(() => {}));
    const res = fingirRes();
    await ctrl.forgotPassword({ body: { email: 'laura@empresa.com' } }, res, () => {});
    expect(res.codigo).toBe(200);
    expect(res.cuerpo.success).toBe(true);
  });

  it('si la base falla, tampoco cambia la respuesta ni se cae', async () => {
    modelo.findActiveUserByEmail.mockRejectedValue(new Error('base caida'));
    const { res, error } = await pedirRecuperacion('laura@empresa.com');
    expect(error).toBeNull();
    expect(res.codigo).toBe(200);
  });

  it('un correo mal escrito SI se rechaza: «pepe@» no es de nadie', async () => {
    const { error } = await pedirRecuperacion('pepe@');
    expect(error?.statusCode).toBe(400);
    expect(error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('el enlace que se manda', () => {
  it('se guarda hasheado, nunca en claro', async () => {
    modelo.findActiveUserByEmail.mockResolvedValue(LAURA);
    await pedirRecuperacion('laura@empresa.com');

    const [, hashGuardado] = modelo.setRecoveryToken.mock.calls[0];
    const enClaro = enviado.mock.calls[0][0].setPasswordToken;

    expect(hashGuardado).not.toBe(enClaro);
    expect(hashGuardado).toMatch(/^[0-9a-f]{64}$/);          // sha256
    // Y que el guardado sea el hash DEL que se mando, no otro cualquiera.
    const esperado = (await import('crypto'))
      .createHash('sha256').update(enClaro).digest('hex');
    expect(hashGuardado).toBe(esperado);
  });

  it('caduca a las 24 horas', async () => {
    modelo.findActiveUserByEmail.mockResolvedValue(LAURA);
    await pedirRecuperacion('laura@empresa.com');

    const [, , expira] = modelo.setRecoveryToken.mock.calls[0];
    const horas = (expira.getTime() - Date.now()) / 3_600_000;
    expect(horas).toBeGreaterThan(23.9);
    expect(horas).toBeLessThan(24.1);
  });

  it('pedirlo dos veces deja valido solo el ultimo', async () => {
    modelo.findActiveUserByEmail.mockResolvedValue(LAURA);
    await pedirRecuperacion('laura@empresa.com');
    await pedirRecuperacion('laura@empresa.com');

    const [primero] = modelo.setRecoveryToken.mock.calls.map((c) => c[1]);
    const segundo = modelo.setRecoveryToken.mock.calls[1][1];
    // Son distintos y el segundo PISA al primero en la misma columna, asi que
    // el primer enlace deja de servir. Si no, cada peticion dejaria una llave
    // mas rodando por los buzones.
    expect(primero).not.toBe(segundo);
    expect(modelo.setRecoveryToken.mock.calls[1][0]).toBe(LAURA.id);
  });

  it('queda apuntado en el registro de actividad', async () => {
    modelo.findActiveUserByEmail.mockResolvedValue(LAURA);
    await pedirRecuperacion('laura@empresa.com');
    expect(modelo.logActivity).toHaveBeenCalledWith(
      LAURA.id, 'password_reset_requested', null, null,
    );
  });
});

describe('al poner la contraseña con el enlace', () => {
  it('se revocan los refresh tokens, y antes de cambiar la clave', async () => {
    // Quien recupera una cuenta suele hacerlo porque no se fia de ella. Solo se
    // revocan los refresh tokens: el access token (JWT) no se consulta en la
    // base y sigue valiendo hasta que caduca por si solo.
    const orden = [];
    modelo.findUserBySetPasswordToken.mockResolvedValue({
      id: LAURA.id, set_password_expires: new Date(Date.now() + 3_600_000),
    });
    modelo.revokeAllUserTokens.mockImplementation(async () => { orden.push('sesiones'); });
    modelo.updatePassword.mockImplementation(async () => { orden.push('clave'); });

    const service = await import('../src/modules/auth/auth.service.js');
    await service.setPassword('token-en-claro', 'ClaveNueva1');

    expect(modelo.revokeAllUserTokens).toHaveBeenCalledWith(LAURA.id);
    expect(orden).toEqual(['sesiones', 'clave']);
  });

  it('con un enlace que no vale no se revoca ningun refresh token', async () => {
    modelo.findUserBySetPasswordToken.mockResolvedValue(null);
    const service = await import('../src/modules/auth/auth.service.js');

    await expect(service.setPassword('token-falso', 'ClaveNueva1')).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    expect(modelo.revokeAllUserTokens).not.toHaveBeenCalled();
    expect(modelo.updatePassword).not.toHaveBeenCalled();
  });

  it('con un enlace caducado tampoco', async () => {
    modelo.findUserBySetPasswordToken.mockResolvedValue({
      id: LAURA.id, set_password_expires: new Date(Date.now() - 1000),
    });
    const service = await import('../src/modules/auth/auth.service.js');

    await expect(service.setPassword('token-viejo', 'ClaveNueva1')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(modelo.revokeAllUserTokens).not.toHaveBeenCalled();
  });
});
