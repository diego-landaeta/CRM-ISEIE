import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * #197 (gemela de CRM#211) · Diego, 06/11 (en la #688): «dejarlo listo para quitar el freno sin
 * tocar código». El freno de correos a tutores se levanta con
 * CORREOS_A_TUTORES=1 en el .env; sin la variable, o con cualquier otro valor,
 * sigue puesto (olvidarla nunca suelta correos). Y con él levantado, a un tutor
 * sí le sale el código para cambiar su correo.
 */

const cargar = async (valor) => {
  if (valor === undefined) delete process.env.CORREOS_A_TUTORES;
  else process.env.CORREOS_A_TUTORES = valor;
  vi.resetModules();
  return {
    freno: (await import('../src/shared/config/frenoTutores.js')).NO_ESCRIBIR_A_TUTORES,
    correo: await import('../src/modules/users/cambio-de-correo.js'),
  };
};

afterEach(() => {
  delete process.env.CORREOS_A_TUTORES;
  vi.resetModules();
});

// Cada caso vuelve a cargar los módulos (vi.resetModules): con toda la batería a
// la vez, la primera carga puede pasar de los 15 s de serie.
describe('#197 (CRM#211) · el freno de tutores se quita desde el .env', { timeout: 60_000 }, () => {
  it('sin la variable, el freno sigue puesto y al tutor no le sale el código', async () => {
    const { freno, correo } = await cargar(undefined);
    expect(freno).toBe(true);
    expect(correo.codigoFrenadoPara({ role: 'tutor', roles_extra: [] })).toBe(true);
    expect(correo.codigoFrenadoPara({ role: 'gestor', roles_extra: ['tutor'] })).toBe(true);
    // A quien no es tutor, nunca.
    expect(correo.codigoFrenadoPara({ role: 'gestor', roles_extra: [] })).toBe(false);
  });

  it('con un valor que no es «1» (true, sí, 0), sigue puesto', async () => {
    for (const v of ['true', 'si', '0', '']) {
      const { freno } = await cargar(v);
      expect(freno, v).toBe(true);
    }
  });

  it('con CORREOS_A_TUTORES=1 se levanta: al tutor ya le sale el código', async () => {
    const { freno, correo } = await cargar('1');
    expect(freno).toBe(false);
    expect(correo.codigoFrenadoPara({ role: 'tutor', roles_extra: [] })).toBe(false);
  });
});
