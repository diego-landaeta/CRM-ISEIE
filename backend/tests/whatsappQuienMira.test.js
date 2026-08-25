import { describe, it, expect, vi, beforeEach } from 'vitest';

// Que quede escrito cuando alguien entra a mirar el WhatsApp de otra persona.
//
// Un administrador puede hacerlo —hace falta para ayudar y para supervisar— pero
// son conversaciones con clientes y algunas seran personales. Poder mirarlas sin
// dejar rastro es lo que convierte una herramienta de trabajo en una de
// vigilancia.

const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));
vi.mock('../src/shared/utils/normalizePhone.js', () => ({
  normalizePhone: (x) => x, phoneCanonical: (x) => x,
}));

const { apuntarMirada } = await import('../src/modules/whatsapp/chat.model.js');

describe('quien mira la sesion de otra persona', () => {
  beforeEach(() => { query.mockReset().mockResolvedValue({ rows: [] }); });

  it('mirar la tuya propia no se apunta', async () => {
    // Si se apuntara, el registro se llenaria de ruido y no serviria para leerlo.
    expect(await apuntarMirada({ quienMira: 3, aQuien: 3 })).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('mirar la de otra si', async () => {
    expect(await apuntarMirada({ quienMira: 3, aQuien: 41, ip: '10.0.0.1' })).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('user_activity_log');
    expect(sql).toContain('whatsapp.mirar_sesion');
    expect(params[0]).toBe(3);
    expect(JSON.parse(params[1])).toEqual({ gestora: 41 });
    expect(params[2]).toBe('10.0.0.1');
  });

  it('no repite: la pantalla pregunta cada pocos segundos', async () => {
    // Sin el freno, una tarde mirando dejaria miles de filas identicas.
    await apuntarMirada({ quienMira: 3, aQuien: 42 });
    query.mockClear();
    for (let i = 0; i < 5; i++) {
      expect(await apuntarMirada({ quienMira: 3, aQuien: 42 })).toBe(false);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('pero cada pareja lleva su cuenta', async () => {
    await apuntarMirada({ quienMira: 3, aQuien: 43 });
    query.mockClear();
    // Otra gestora distinta: es otra mirada, y tiene que quedar.
    expect(await apuntarMirada({ quienMira: 3, aQuien: 44 })).toBe(true);
    expect(query).toHaveBeenCalled();
  });

  it('si no se puede apuntar, no se deja a nadie sin trabajar', async () => {
    // Quien esta ayudando a una gestora no puede quedarse bloqueado porque el
    // registro falle.
    query.mockRejectedValue(new Error('base caida'));
    await expect(apuntarMirada({ quienMira: 3, aQuien: 45 })).resolves.toBe(false);
  });

  it('sin los dos identificadores no hace nada', async () => {
    expect(await apuntarMirada({ quienMira: null, aQuien: 4 })).toBe(false);
    expect(await apuntarMirada({ quienMira: 3, aQuien: null })).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});
