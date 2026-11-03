import { describe, it, expect, vi, beforeEach } from 'vitest';

// Los correos de los lunes con las cifras separadas (Diego, 19/10/2026).
//
//   · «Tu semana» le contaba a cada gestora los prospectos y las ventas de TODO
//     el equipo (Diana, del 12 al 18/10: 408 y 8; los suyos, 32 y 0) porque
//     salian de `overview`, que no aplicaba la gestora. Ahora salen de SU fila
//     del ranking, y lo cobrado viene partido en tres.
//   · El «Reporte semanal» de dirección: el ranking con Vendido, Facturado,
//     Cobrado (de la semana / anteriores / cuotas) y Pendiente, la fila «Sin
//     gestora» y el Total, que es la tarjeta Cobrado de arriba.

const COBRADO_DE_LA_TARJETA = 7795;

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql) => {
    if (sql.includes('FROM user_projects up')) return { rows: [{ id: 1, nombre: 'ISEIE', sociedad_id: null }] };
    // La tarjeta Cobrado del reporte de dirección (los pagos de la semana).
    if (sql.includes('FROM conversion_payments p JOIN conversions c')) return { rows: [{ cobrado: String(COBRADO_DE_LA_TARJETA) }] };
    return { rows: [] };
  }),
}));

// El equipo entero, para que se note si se cuela en «Tu semana».
const overview = vi.fn(async () => ({
  leads: { total: 408, convertido: 8 },
  conversions: { total: 8 },
}));

const DIANA = {
  puesto: 1, de: 2, nombre: 'Diana', leads: 32, ventas: 0, vendido: 0, facturado: 125, pendiente: 0,
  cobrado: 2100, cobrado_del_periodo: 0, cobrado_anteriores: 1975, cobrado_en_cuotas: 125,
  ventas_anteriores: 1, anteriores_grandes: [{ venta_id: 676, fecha_venta: '2026-09-30', importe: 1975 }],
  tasa: 0, tasa_equipo: 2.8, faltan_para_subir: null, mejor_cobrado: 2100,
};
const ANA = {
  puesto: 2, nombre: 'Ana', leads: 40, ventas: 2, vendido: 3000, facturado: 1500, pendiente: 1500,
  cobrado: 1500, cobrado_del_periodo: 1500, cobrado_anteriores: 0, cobrado_en_cuotas: 0,
  ventas_anteriores: 0, anteriores_grandes: [], tasa: 5,
};
const SIN = {
  leads: 5, ventas: 0, vendido: 0, facturado: 0, pendiente: 0, cobrado: 4195,
  cobrado_del_periodo: 0, cobrado_anteriores: 4195, cobrado_en_cuotas: 0,
  anteriores_grandes: [{ venta_id: 666, fecha_venta: '2026-09-25', importe: 4195 }], tasa: 0,
};
const TOTAL = {
  leads: 77, ventas: 2, vendido: 3000, facturado: 1625, pendiente: 1500, cobrado: 7795,
  cobrado_del_periodo: 1500, cobrado_anteriores: 6170, cobrado_en_cuotas: 125, anteriores_grandes: [], tasa: 2.6,
};

const miPuesto = vi.fn(async ({ from, esJefe }) => {
  if (from === '2026-10-05') return { ...DIANA, puesto: 2, leads: 30, ventas: 1, tabla: null };
  if (esJefe) return { ...DIANA, tabla: [DIANA, ANA], sin_gestora: SIN, total: TOTAL };
  return { ...DIANA, tabla: null, sin_gestora: null, total: null };
});

vi.mock('../src/modules/reports/report.model.js', () => ({
  overview: (...a) => overview(...a),
  miPuesto: (...a) => miPuesto(...a),
  ventasVendedora: vi.fn(async () => []),
  // Los contactos por campus y por gestora (#270): aqui no se prueban, solo hace
  // falta que existan para que el correo los pida.
  contactosPorCampus: vi.fn(async () => []),
  contactosPorGestora: vi.fn(async () => []),
}));
vi.mock('../src/modules/proceso/proceso.model.js', () => ({
  resumenDeLaCola: vi.fn(async () => ({ esta_semana: 4, atrasados: 1, hoy: 0, manana: 0 })),
}));

const C = await import('../src/jobs/correosDelEquipo.js');
// Un lunes: la semana que se reporta es la del 12 al 18 de octubre.
const LUNES = new Date('2026-10-19T09:00:00');
const sinEtiquetas = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => { overview.mockClear(); miPuesto.mockClear(); });

describe('(d) «Tu semana»: los números de la gestora, no los del equipo', () => {
  it('prospectos y ventas salen de SU fila del ranking', async () => {
    const r = await C.correoSemanalGestora({ id: 7, nombre: 'Diana Pérez' }, LUNES);
    const texto = sinEtiquetas(r.html);
    expect(texto).toMatch(/Prospectos recibidos 32/);
    expect(texto).toMatch(/Ventas 0/);
    expect(texto).not.toMatch(/408/);
    // Ni se le pregunta a `overview` por el equipo.
    expect(overview).not.toHaveBeenCalled();
    expect(miPuesto).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, from: '2026-10-12', to: '2026-10-18' }));
  });

  it('y su cobrado, partido en tres, con la venta anterior grande y su fecha', async () => {
    const r = await C.correoSemanalGestora({ id: 7, nombre: 'Diana Pérez' }, LUNES);
    const texto = sinEtiquetas(r.html);
    expect(texto).toMatch(/Cobrado \(por fecha de cobro\) 2100\s€/);
    expect(texto).toMatch(/de ventas de esta semana 0\s€/);
    expect(texto).toMatch(/de ventas anteriores 1975\s€ · venta #676 del 30\/09 1975\s€/);
    expect(texto).toMatch(/cuotas 125\s€/);
    expect(texto).toMatch(/Facturado \(por fecha de factura\) 125\s€/);
    expect(texto).toMatch(/Vendido \(por fecha de venta\) 0 ventas · 0\s€/);
  });

  it('si el ranking de la semana falla, no se manda un correo con ceros', async () => {
    miPuesto.mockImplementationOnce(async () => { throw new Error('caida'); });
    await expect(C.correoSemanalGestora({ id: 7, nombre: 'Diana' }, LUNES)).rejects.toThrow('caida');
  });
});

describe('(c) el «Reporte semanal» de dirección', () => {
  it('lleva las columnas separadas, «Sin gestora» y un Total que es la tarjeta Cobrado', async () => {
    const r = await C.correoSemanalDireccion({ id: 2, role: 'admin', nombre: 'Diego' }, LUNES);
    const texto = sinEtiquetas(r.html);
    expect(texto).toMatch(/Gestora Vendido Facturado Cobrado De la semana Anteriores Cuotas Pendiente/);
    expect(texto).toMatch(/1\. Diana 32 prosp\. · 0 % conv\. 0 · 0\s€ 125\s€ 2100\s€ 0\s€ 1975\s€ 125\s€ 0\s€/);
    expect(texto).toMatch(/Sin gestora 0 · 0\s€ 0\s€ 4195\s€ 0\s€ 4195\s€ 0\s€ 0\s€/);
    expect(texto).toMatch(/Total 2 · 3000\s€ 1625\s€ 7795\s€ 1500\s€ 6170\s€ 125\s€ 1500\s€/);
    // La tarjeta de arriba y el Total dicen lo mismo.
    expect(texto).toMatch(/Cobrado 7795\s€/);
    expect(TOTAL.cobrado).toBe(COBRADO_DE_LA_TARJETA);
  });

  it('dice qué venta anterior trae el dinero grande, también la que no es de nadie', async () => {
    const texto = sinEtiquetas((await C.correoSemanalDireccion({ id: 2, role: 'admin' }, LUNES)).html);
    expect(texto).toMatch(/Diana · 1975\s€ · venta #676 del 30\/09/);
    expect(texto).toMatch(/Sin gestora · 4195\s€ · venta #666 del 25\/09/);
  });

  it('y por qué fecha cuenta cada columna', async () => {
    const texto = sinEtiquetas((await C.correoSemanalDireccion({ id: 2, role: 'admin' }, LUNES)).html);
    expect(texto).toMatch(/Vendido cuenta por fecha de venta/);
    expect(texto).toMatch(/Facturado , por fecha de factura; Cobrado , por fecha de cobro/);
  });
});

describe('las piezas', () => {
  it('con más de doce gestoras, las de abajo van juntas y las filas siguen sumando', () => {
    const tabla = Array.from({ length: 14 }, (_, i) => ({ ...ANA, puesto: i + 1, nombre: `G${i + 1}`, cobrado: 100, cobrado_del_periodo: 100 }));
    const html = C.tablaDelRanking({ tabla, sin_gestora: null, total: { ...TOTAL, cobrado: 1400 } }, { tope: 12 });
    const texto = sinEtiquetas(html);
    expect(texto).toMatch(/Otras 2 4 · 6000\s€ 3000\s€ 200\s€/);
    expect(texto).not.toMatch(/13\. G13/);
  });

  it('«30/09» a partir de la fecha de la venta', () => {
    expect(C.diaMes('2026-09-30')).toBe('30/09');
    expect(C.anterioresGrandes([{ venta_id: 676, fecha_venta: '2026-09-30', importe: 1975 }])[0]).toMatch(/^1975\s€ · venta #676 del 30\/09$/);
  });
});
