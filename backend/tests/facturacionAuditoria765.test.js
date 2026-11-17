import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * CRM#765 (gemela CRM-ISEIE#453) · Auditoría de facturación, sin base.
 *
 *   · Con el interruptor APAGADO (el de serie) no cambia nada: ni una consulta
 *     a las tablas de la auditoría, ni pausa, ni cola, ni tarea programada.
 *   · La pausa para la emisión con 423, salvo los cobros que ya estaban
 *     atrasados al pausar (son los que hay que facturar para salir de ella).
 *   · El correo va a los administradores y a FACTURACION_AUDITORIA_CORREOS,
 *     con la plantilla común, la marca del campus y uno por pausa.
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

const sendEmail = vi.fn(async () => ({ sent: true }));
vi.mock('../src/shared/services/brevo.service.js', () => ({ sendEmail }));
vi.mock('../src/shared/services/marca.service.js', () => ({
  marcaDeLosCampus: vi.fn(async (ids) => (ids.length === 1 ? { id: ids[0], nombre: 'ISEIH', slug: 'iseih' } : null)),
  remitenteDe: (m) => ({ projectId: m?.id ?? null, fromName: m?.nombre }),
}));

const { leerConfig } = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.config.js');
const pausa = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.pausa.js');
const servicio = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.service.js');
const correo = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.correo.js');
const { startFacturacionAuditoriaScheduler, runFacturacionAuditoria } = await import('../src/jobs/facturacionAuditoriaJob.js');

const ENCENDIDA = { FACTURACION_AUDITORIA_ACTIVA: 'true', FACTURACION_AUDITORIA_CORREOS: 'manuel@example.com, no-es-correo' };
const tocaLaAuditoria = () => consultas.filter((c) => /facturacion_(pausas|auditorias|cola_pausa|auditoria_estado)/.test(c.sql));

beforeEach(() => {
  consultas.length = 0;
  respuestas = [];
  sendEmail.mockClear();
  delete process.env.FACTURACION_AUDITORIA_ACTIVA;
});
afterEach(() => { delete process.env.FACTURACION_AUDITORIA_ACTIVA; });

describe('la configuración', () => {
  it('apagada de serie, 9 días, y los correos de más se filtran', () => {
    expect(leerConfig({})).toMatchObject({ activa: false, dias: 9, desde: null, correos: [] });
    const c = leerConfig({ ...ENCENDIDA, FACTURACION_AUDITORIA_DIAS: '12', FACTURACION_AUDITORIA_DESDE: '2026-11-01' });
    expect(c).toMatchObject({ activa: true, dias: 12, desde: '2026-11-01', correos: ['manuel@example.com'] });
    expect(leerConfig({ FACTURACION_AUDITORIA_DESDE: '2026-02-31' }).desde).toBeNull();
  });
});

describe('con el interruptor APAGADO no cambia nada', () => {
  it('la emisión no pregunta por la pausa', async () => {
    await expect(pausa.exigirFacturacionActiva({ paymentId: 5 })).resolves.toBeUndefined();
    expect(await pausa.pausaAbierta()).toBeNull();
    expect(consultas).toHaveLength(0);
  });

  it('ni auditoría, ni cola, ni estado, ni tarea programada', async () => {
    expect(await servicio.auditar()).toEqual({ omitido: 'apagada' });
    expect(await servicio.encolarSiPausada({ paymentId: 5, conversionId: 1 })).toBe(false);
    expect(await servicio.estado()).toEqual({ activa: false });
    expect(await runFacturacionAuditoria()).toEqual({ omitido: 'apagada' });
    expect(startFacturacionAuditoriaScheduler()).toBeNull();
    await expect(servicio.reanudar({ userId: 1 })).rejects.toMatchObject({ code: 'AUDITORIA_APAGADA' });
    expect(tocaLaAuditoria()).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('crear una factura no toca la auditoría', async () => {
    // El camino de siempre, con la base simulada: lo que importa es que
    // ninguna consulta mire las tablas de la pausa.
    const { getClient } = await import('../src/shared/config/db.js');
    const cliente = { query: vi.fn(async (sql) => {
      consultas.push({ sql });
      if (/FROM invoice_issuers/.test(sql)) return { rows: [{ id: 1, nif: 'B12345674', serie: 'A', razon_social: 'X' }] };
      if (/AS usado/.test(sql)) return { rows: [{ usado: 3 }] };
      if (/INSERT INTO invoices/.test(sql)) return { rows: [{ id: 9, numero: 4 }] };
      return { rows: [] };
    }), release: vi.fn() };
    getClient.mockResolvedValue(cliente);
    const { create } = await import('../src/modules/invoices/invoices.model.js');
    const inv = await create({ projectId: 1, clienteNombre: 'Ana', items: [], total: 1, baseImponible: 1, ivaPct: 0 }, null);
    expect(inv.numero).toBe(4);
    expect(tocaLaAuditoria()).toHaveLength(0);
  });
});

describe('con la facturación PAUSADA', () => {
  const PAUSA = { id: 3, pausada_at: '2026-11-17T10:00:00Z', motivo: 'Números repetidos en una serie: 1', incidencias: [] };
  beforeEach(() => {
    Object.assign(process.env, ENCENDIDA);
    respuestas = [{ si: /FROM facturacion_pausas/, rows: [PAUSA] }];
  });

  it('emitir da 423 FACTURACION_PAUSADA', async () => {
    await expect(pausa.exigirFacturacionActiva()).rejects.toMatchObject({ statusCode: 423, code: 'FACTURACION_PAUSADA' });
  });

  it('un cobro que ya estaba atrasado al pausar sí se puede facturar', async () => {
    respuestas.push({ si: /FROM conversion_payments/, rows: (p) => (p[0] === 7 ? [{ 1: 1 }] : []) });
    await expect(pausa.exigirFacturacionActiva({ paymentId: 7 })).resolves.toBeUndefined();
    await expect(pausa.exigirFacturacionActiva({ paymentId: 8 })).rejects.toMatchObject({ code: 'FACTURACION_PAUSADA' });
    const atraso = consultas.find((c) => /FROM conversion_payments/.test(c.sql));
    expect(atraso.params).toEqual([7, PAUSA.pausada_at, 9]);
  });

  it('la cola de la pausa, al reanudar, no se para a sí misma', async () => {
    await expect(pausa.emitiendoLaColaDeLaPausa(() => pausa.exigirFacturacionActiva())).resolves.toBeUndefined();
  });

  it('un cobro que entra se encola en vez de facturarse', async () => {
    expect(await servicio.encolarSiPausada({ paymentId: 11, conversionId: 4, userId: 2 })).toBe(true);
    const ins = consultas.find((c) => /INSERT INTO facturacion_cola_pausa/.test(c.sql));
    expect(ins.params).toEqual([11, 4, 3, 2]);
  });
});

describe('el correo de la pausa', () => {
  const INCIDENCIAS = [
    { tipo: 'numero_repetido', serie: 'CEDIA', project_ids: [2], texto: 'Serie CEDIA: el 2026/0005 lo llevan 2 facturas' },
    { tipo: 'cobro_sin_factura', serie: 'CEDIA', project_ids: [2], texto: 'Serie CEDIA: cobro de 100,00 € del 01/11/2026 de <Ana> (ISEIH) sin factura' },
  ];
  const RESUMEN = { desde: '2026-11-17', dias: 9, numero_repetido: 1, datos_fiscales: 0, cobro_sin_factura: 1 };

  it('a los administradores y a los del .env, con la marca del campus y uno por pausa', async () => {
    Object.assign(process.env, ENCENDIDA);
    respuestas = [{ si: /FROM users/, rows: [{ email: 'admin@example.com' }, { email: 'manuel@example.com' }] }];
    await correo.avisarDeLaPausa({ pausa: { id: 3 }, incidencias: INCIDENCIAS, resumen: RESUMEN, cfg: leerConfig() });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const e = sendEmail.mock.calls[0][0];
    expect(e.to).toBe('admin@example.com,manuel@example.com');
    expect(e.subject).toBe('Facturación pausada · ISEIH');
    expect(e.clave).toBe('facturacion-pausada-3');
    expect(e.projectId).toBe(2);
    // La plantilla común: cabecera con la marca, el detalle escapado y el botón.
    expect(e.htmlContent).toContain('ISEIH');
    expect(e.htmlContent).toContain('Serie CEDIA: el 2026/0005 lo llevan 2 facturas');
    expect(e.htmlContent).toContain('&lt;Ana&gt;');
    expect(e.htmlContent).toContain('Marcar como solucionado');
    expect(e.textContent).toContain('Facturación pausada por la auditoría');
  });

  it('sin nadie a quien mandarlo, no se manda y se dice', async () => {
    respuestas = [{ si: /FROM users/, rows: [] }];
    const r = await correo.avisarDeLaPausa({ pausa: { id: 4 }, incidencias: INCIDENCIAS, resumen: RESUMEN, cfg: leerConfig({}) });
    expect(r).toEqual({ sent: false, reason: 'SIN_DESTINATARIOS' });
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('las fechas', () => {
  it('restar días no baila con la hora', () => {
    expect(servicio.restarDias('2026-11-17', 9)).toBe('2026-11-08');
    expect(servicio.restarDias('2026-03-02', 2)).toBe('2026-02-28');
  });
  it('el motivo dice cuántas de cada', () => {
    expect(servicio.motivoDe({ numero_repetido: 2, datos_fiscales: 0, cobro_sin_factura: 1 }))
      .toBe('Números repetidos en una serie: 2 · Cobros sin factura: 1');
  });
});
