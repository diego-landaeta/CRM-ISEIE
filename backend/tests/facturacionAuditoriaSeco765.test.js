import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * CRM#765 / CRM#764 (24/11) · Antes de encender la auditoría, sin base.
 *
 *   · La PASADA EN SECO (`simular`) hace las tres comprobaciones y no escribe
 *     nada: ni la vuelta, ni la pausa, ni el «desde», ni avisos. Funciona con
 *     la auditoría apagada.
 *   · El MODO AVISO (FACTURACION_AUDITORIA_PAUSAR=0) audita y lo apunta, pero
 *     no pausa ni manda el correo de la pausa; avisa en la campana solo cuando
 *     deja de salir limpia.
 */

const consultas = [];
let respuestas = [];

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    const r = respuestas.find((x) => x.si.test(sql));
    return r ? { rows: typeof r.rows === 'function' ? r.rows(params) : r.rows } : { rows: [] };
  }),
  getClient: vi.fn(),
}));

const notifyAdmins = vi.fn(async () => {});
vi.mock('../src/modules/notifications/notifications.service.js', async (original) => ({ ...(await original()), notifyAdmins }));
const avisarDeLaPausa = vi.fn(async () => {});
vi.mock('../src/modules/facturacion-auditoria/facturacion-auditoria.correo.js', async (original) => ({ ...(await original()), avisarDeLaPausa }));

const { leerConfig } = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.config.js');
const servicio = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.service.js');

const REPETIDO = {
  ano: 2026, serie: 'CEDIA', numero: 7, veces: 2, ids: [1, 2], project_ids: [1],
  facturas: [{ cliente: 'Ana', total: 10, fecha: '2026-11-20', estado: 'emitida', tipo: 'normal' }],
};
const escribe = () => consultas.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql));
const ENCENDIDA = { activa: true, dias: 9, desde: '2026-11-01', correos: [] };

beforeEach(() => {
  consultas.length = 0;
  respuestas = [{ si: /HAVING COUNT\(\*\) > 1/, rows: [REPETIDO] }];
  notifyAdmins.mockClear();
  avisarDeLaPausa.mockClear();
});

describe('FACTURACION_AUDITORIA_PAUSAR', () => {
  it('de serie pausa; con 0 (o «no»), modo aviso', () => {
    expect(leerConfig({}).pausar).toBe(true);
    expect(leerConfig({ FACTURACION_AUDITORIA_PAUSAR: '1' }).pausar).toBe(true);
    expect(leerConfig({ FACTURACION_AUDITORIA_PAUSAR: '0' }).pausar).toBe(false);
    expect(leerConfig({ FACTURACION_AUDITORIA_PAUSAR: 'no' }).pausar).toBe(false);
  });
});

describe('la pasada en seco', () => {
  it('apagada también: encuentra lo que pausaría y no escribe nada', async () => {
    const r = await servicio.simular({ cfg: leerConfig({}), ahora: new Date('2026-11-24T12:00:00Z') });
    expect(r.desde).toBe('2026-11-24'); // sin vueltas ni .env: hoy, como la primera vuelta
    expect(r.hasta).toBe('2026-11-15');
    expect(r.limpia).toBe(false);
    expect(r.pausaria).toBe(true);
    expect(r.resumen).toMatchObject({ numero_repetido: 1, datos_fiscales: 0, cobro_sin_factura: 0 });
    expect(escribe()).toEqual([]);
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('con otra fecha de corte, esa; con el modo aviso, no pausaría', async () => {
    const r = await servicio.simular({ desde: '2026-07-01', cfg: { ...ENCENDIDA, pausar: false } });
    expect(r.desde).toBe('2026-07-01');
    expect(r.pausaria).toBe(false);
    const repetidos = consultas.find((c) => /HAVING COUNT/.test(c.sql));
    expect(repetidos.params).toEqual(['2026-07-01']);
    expect(escribe()).toEqual([]);
  });

  it('sin fecha pedida usa la guardada de la primera vuelta, sin escribirla', async () => {
    respuestas.push({ si: /FROM facturacion_auditoria_estado/, rows: [{ desde: '2026-11-25' }] });
    const r = await servicio.simular({ cfg: leerConfig({}) });
    expect(r.desde).toBe('2026-11-25');
    expect(escribe()).toEqual([]);
  });
});

describe('el modo aviso', () => {
  beforeEach(() => {
    respuestas.push(
      { si: /INSERT INTO facturacion_auditorias/, rows: [{ id: 41, limpia: false }] },
      { si: /INSERT INTO facturacion_pausas/, rows: [{ id: 9 }] },
    );
  });

  it('con errores: apunta la vuelta, NO pausa ni manda el correo, y avisa una vez', async () => {
    const r = await servicio.auditar({ origen: 'programada', cfg: { ...ENCENDIDA, pausar: false } });
    expect(r.limpia).toBe(false);
    expect(r.pausa).toBeNull();
    expect(consultas.some((c) => /INSERT INTO facturacion_auditorias/.test(c.sql))).toBe(true);
    expect(consultas.some((c) => /INSERT INTO facturacion_pausas/.test(c.sql))).toBe(false);
    expect(avisarDeLaPausa).not.toHaveBeenCalled();
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    expect(notifyAdmins.mock.calls[0][0].message).toMatch(/NO se pausa/);
  });

  it('si la vuelta anterior ya tenía errores, no vuelve a avisar', async () => {
    respuestas.push({ si: /WHERE id < \$1/, rows: [{ id: 40, limpia: false }] });
    await servicio.auditar({ origen: 'programada', cfg: { ...ENCENDIDA, pausar: false } });
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('de serie (pausar) sigue pausando como en #765', async () => {
    const r = await servicio.auditar({ origen: 'programada', cfg: { ...ENCENDIDA, pausar: true } });
    expect(consultas.some((c) => /INSERT INTO facturacion_pausas/.test(c.sql))).toBe(true);
    expect(r.pausa?.id).toBe(9);
  });
});
