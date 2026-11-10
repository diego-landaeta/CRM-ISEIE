import { describe, it, expect, vi, beforeEach } from 'vitest';

// CIFRAS SEPARADAS en el ranking de gestoras (Diego, 19/10/2026).
//
// El caso real: el reporte de la semana del 12 al 18/10 puso a Diana la primera
// con 2.100 € cobrados y 0 ventas. 1.975 € eran una transferencia del 16/10 de
// la venta #676, del 30/09, y 125 € una cuota de la #527. Lo cobrado se parte
// ahora en tres —de ventas del periodo, de ventas anteriores y cuotas—, el
// dinero sin gestora sale en su fila y el Total cuadra con la tarjeta.
//
// Aqui, con la base simulada: lo que hace `miPuesto` con las filas y la forma
// de las consultas. Lo mismo contra Postgres de verdad esta en
// `rankingCifrasSeparadasBase.test.js` (corre en la CI).

let filas = [];
const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: filas }; }),
}));

const { miPuesto, asesorasPorMes, overview, detalleMetrica, ANTERIOR_GRANDE } = await import('../src/modules/reports/report.model.js');

// Una fila de `asesorasPorMes`, como la devuelve la consulta.
const fila = (id, nombre, x = {}) => ({
  mes: 'rango', asesora_id: id, asesora: nombre,
  leads: 0, ventas: 0, vendido: 0, facturado: 0, pendiente: 0,
  cobrado: 0, cobrado_del_periodo: 0, cobrado_anteriores: 0, cobrado_en_cuotas: 0,
  ventas_anteriores: 0, anteriores_grandes: [],
  ...x,
});

// La semana del 12 al 18/10, con los numeros del caso.
const SEMANA = () => [
  fila(7, 'Diana', {
    leads: 32, ventas: 0, vendido: 0, facturado: 125, cobrado: 2100,
    cobrado_del_periodo: 0, cobrado_anteriores: 1975, cobrado_en_cuotas: 125, ventas_anteriores: 1,
    anteriores_grandes: [{ venta_id: 676, fecha_venta: '2026-09-30', importe: 1975 }],
  }),
  fila(6, 'Ana', {
    leads: 40, ventas: 2, vendido: 3000, facturado: 1500, pendiente: 1500, cobrado: 1500,
    cobrado_del_periodo: 1500,
  }),
  // Una venta sin vendedora de un lead sin responsable: el cobro #1197.
  fila(null, '— sin asesora —', {
    leads: 5, cobrado: 4195, cobrado_anteriores: 4195, ventas_anteriores: 1,
    anteriores_grandes: [{ venta_id: 666, fecha_venta: '2026-09-25', importe: 4195 }],
  }),
];

beforeEach(() => { filas = []; consultas.length = 0; });

describe('miPuesto: las cifras separadas', () => {
  it('(a) el cobro de una venta de otro mes va a «de ventas anteriores», con su nº y su fecha', async () => {
    filas = SEMANA();
    const r = await miPuesto({ userId: 7, projectIds: [1], from: '2026-10-12', to: '2026-10-18', esJefe: true });
    const diana = r.tabla.find((f) => f.nombre === 'Diana');
    expect(diana.cobrado_del_periodo).toBe(0);
    expect(diana.cobrado_anteriores).toBe(1975);
    expect(diana.anteriores_grandes).toEqual([{ venta_id: 676, fecha_venta: '2026-09-30', importe: 1975 }]);
  });

  it('(b) la cuota va a «cuotas», y las tres partes suman lo cobrado de la fila', async () => {
    filas = SEMANA();
    const r = await miPuesto({ userId: 7, projectIds: [1], from: '2026-10-12', to: '2026-10-18', esJefe: true });
    for (const f of [...r.tabla, r.sin_gestora, r.total]) {
      expect(f.cobrado_del_periodo + f.cobrado_anteriores + f.cobrado_en_cuotas).toBeCloseTo(f.cobrado, 2);
    }
    expect(r.tabla.find((f) => f.nombre === 'Diana').cobrado_en_cuotas).toBe(125);
  });

  it('(c) lo que no es de nadie sale en «Sin gestora», y el Total suma todas las filas', async () => {
    filas = SEMANA();
    const r = await miPuesto({ userId: 7, projectIds: [1], from: '2026-10-12', to: '2026-10-18', esJefe: true });
    // No compite: no esta en la tabla ni cuenta en el «de N».
    expect(r.tabla.map((f) => f.nombre)).toEqual(['Diana', 'Ana']);
    expect(r.de).toBe(2);
    expect(r.sin_gestora.cobrado).toBe(4195);
    expect(r.sin_gestora.anteriores_grandes).toEqual([{ venta_id: 666, fecha_venta: '2026-09-25', importe: 4195 }]);
    // El Total es la suma de las filas, «Sin gestora» incluida: 2.100 + 1.500 + 4.195.
    expect(r.total.cobrado).toBe(7795);
    for (const k of ['ventas', 'vendido', 'facturado', 'pendiente', 'cobrado_del_periodo', 'cobrado_anteriores', 'cobrado_en_cuotas', 'leads']) {
      const suma = r.tabla.reduce((s, f) => s + f[k], 0) + r.sin_gestora[k];
      expect(r.total[k], k).toBeCloseTo(suma, 2);
    }
    // Lo de siempre no cambia: el «del equipo» son las gestoras.
    expect(r.cobrado_equipo).toBe(3600);
  });

  it('sigue ordenado por lo cobrado (08/10), aunque otra haya vendido más', async () => {
    filas = SEMANA();
    const r = await miPuesto({ userId: 6, projectIds: [1], esJefe: true });
    expect(r.tabla[0].nombre).toBe('Diana');
    expect(r.puesto).toBe(2);
  });

  it('una gestora ve sus cifras separadas, pero ni la tabla ni «Sin gestora» ni el Total', async () => {
    filas = SEMANA();
    const r = await miPuesto({ userId: 7, projectIds: [1] });
    expect(r.tabla).toBeNull();
    expect(r.sin_gestora).toBeNull();
    expect(r.total).toBeNull();
    expect(r.cobrado_anteriores).toBe(1975);
    expect(r.anteriores_grandes[0].venta_id).toBe(676);
  });

  it('las ventas anteriores grandes: desde el umbral, la mayor primero, como mucho tres', async () => {
    filas = [fila(7, 'Diana', {
      cobrado: 5000, cobrado_anteriores: 5000,
      anteriores_grandes: [
        { venta_id: 1, fecha_venta: '2026-09-01', importe: 400 },
        { venta_id: 2, fecha_venta: '2026-09-02', importe: 2000 },
        { venta_id: 3, fecha_venta: '2026-09-03', importe: ANTERIOR_GRANDE - 1 },
        { venta_id: 4, fecha_venta: '2026-09-04', importe: 900 },
        { venta_id: 5, fecha_venta: '2026-09-05', importe: 700 },
      ],
    })];
    const r = await miPuesto({ userId: 7, projectIds: [1] });
    expect(r.anteriores_grandes.map((g) => g.venta_id)).toEqual([2, 4, 5]);
  });

  it('agrupa por el RANGO, no por mes: «del periodo» se decide contra la semana entera', async () => {
    await miPuesto({ userId: 7, projectIds: [1], from: '2026-09-28', to: '2026-10-04' });
    const { sql, params } = consultas[0];
    expect(sql).toMatch(/'rango'::text AS mes/);
    expect(sql).not.toMatch(/to_char\(\(c\.fecha_conversion\)::date, 'YYYY-MM'\) = to_char/);
    // Los dos limites del periodo van al final.
    expect(params.slice(-2)).toEqual(['2026-09-28', '2026-10-04']);
  });
});

describe('asesorasPorMes: la regla de las tres cajas', () => {
  it('primero «del periodo», luego «cuotas» (plan de pago o mensualidad), y el resto «anteriores»', async () => {
    await asesorasPorMes({ projectIds: [1], from: '2026-10-01', to: '2026-10-31', base: 'cobro' });
    const { sql } = consultas[0];
    const caso = sql.slice(sql.indexOf('CASE WHEN COALESCE(NOT c.es_mensualidad'));
    const periodo = caso.indexOf("THEN 'periodo'");
    const cuotas = caso.indexOf("THEN 'cuotas'");
    const anteriores = caso.indexOf("ELSE 'anteriores'");
    expect(periodo).toBeGreaterThan(0);
    expect(cuotas).toBeGreaterThan(periodo);
    expect(anteriores).toBeGreaterThan(cuotas);
    // Cuota = salda una cuota del plan (el cobro enlazado) o es de una mensualidad.
    expect(caso.slice(periodo, cuotas)).toMatch(/c\.es_mensualidad\s+OR EXISTS \(SELECT 1 FROM conversion_installments ci WHERE ci\.payment_id = cp\.id\)/);
    // Del periodo = la venta cae en el mismo mes que el cobro y dentro del rango.
    expect(caso.slice(0, periodo)).toMatch(/to_char\(\(c\.fecha_conversion\)::date, 'YYYY-MM'\) = to_char\(\(cp\.fecha\)::date, 'YYYY-MM'\)/);
  });

  it('con «cerrado» y «factura» usa las fechas de su base, también para decidir la caja', async () => {
    await asesorasPorMes({ projectIds: [1], from: '2026-10-01', to: '2026-10-31', base: 'cerrado' });
    let caso = consultas[0].sql.slice(consultas[0].sql.indexOf('CASE WHEN COALESCE(NOT c.es_mensualidad'));
    expect(caso.slice(0, caso.indexOf("THEN 'periodo'"))).toMatch(/GREATEST\(c\.fecha_conversion/);
    consultas.length = 0;
    await asesorasPorMes({ projectIds: [1], from: '2026-10-01', to: '2026-10-31', base: 'factura' });
    caso = consultas[0].sql.slice(consultas[0].sql.indexOf('CASE WHEN COALESCE(NOT c.es_mensualidad'));
    expect(caso.slice(0, caso.indexOf("THEN 'periodo'"))).toMatch(/i\.fecha_emision FROM invoices i\s+JOIN conversion_payments cpf/);
  });

  it('lo de siempre sigue igual: «de venta» es el primer cobro, para el Excel y el PDF', async () => {
    await asesorasPorMes({ projectIds: [1], from: '2026-10-01', to: '2026-10-31' });
    const { sql } = consultas[0];
    expect(sql).toMatch(/SUM\(imp\) FILTER \(WHERE es_primero\), 0\) AS cobrado_venta/);
    expect(sql).toMatch(/SUM\(imp\) FILTER \(WHERE NOT es_primero\), 0\) AS cobrado_cuotas/);
  });

  it('el pendiente es de las ventas del periodo, contra lo cobrado de verdad, y no baja de cero', async () => {
    await asesorasPorMes({ projectIds: [1], from: '2026-10-01', to: '2026-10-31' });
    expect(consultas[0].sql).toMatch(/GREATEST\(c\.importe_total - COALESCE\(\(\s*SELECT SUM\(cpp\.importe\) FROM conversion_payments cpp/);
  });

  it('los parámetros van numerados sin huecos, por mes y por rango, con y sin fechas', async () => {
    for (const extra of [{}, { from: '2026-10-01' }, { from: '2026-10-01', to: '2026-10-31' }, { asesoraId: 7 }]) {
      for (const agrupar of ['mes', 'rango']) {
        for (const base of ['cobro', 'factura', 'cerrado']) {
          consultas.length = 0;
          await asesorasPorMes({ projectIds: [1, 2], ...extra, agrupar, base });
          const { sql, params } = consultas[0];
          const usados = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
          expect(Math.max(...usados)).toBe(params.length);
          for (let k = 1; k <= params.length; k++) expect(usados.has(k), `falta $${k}`).toBe(true);
        }
      }
    }
  });
});

describe('(d) overview con gestora: lo suyo, no lo del equipo (el bug de «Tu semana»)', () => {
  it('recorta prospectos por su responsable y ventas por su parte de la venta', async () => {
    filas = [{ total: 0, convertido: 0 }];
    await overview({ projectIds: [1], from: '2026-10-12', to: '2026-10-18', asesoraId: 7 });
    const deLeads = consultas.filter((c) => /FROM leads|FROM \(SELECT \* FROM leads/.test(c.sql) && !/FROM projects p/.test(c.sql));
    expect(deLeads.length).toBe(3);
    for (const { sql, params } of deLeads) {
      // La gestora va como lista desde el equipo comercial (09/11/2026).
      expect(sql).toMatch(/responsable_id = ANY\(\$4::int\[\]\)/);
      expect(params).toEqual([[1], '2026-10-12', '2026-10-18', [7]]);
    }
    const ventas = consultas.find((c) => /as ventas_brutas/.test(c.sql));
    expect(ventas.sql).toMatch(/EXISTS \(SELECT 1 FROM conversion_reparto r WHERE r\.conversion_id = conversions\.id AND r\.vendedora_id = ANY\(\$4::int\[\]\)\)/);
    expect(ventas.sql).toMatch(/SUM\(\(SELECT SUM\(r\.peso\) FROM conversion_reparto r/);
    const cobros = consultas.find((c) => /FROM conversion_payments cp/.test(c.sql));
    expect(cobros.params).toEqual([[1], [7]]);
    expect(cobros.sql).toMatch(/r\.vendedora_id = ANY\(\$2::int\[\]\)/);
  });

  it('sin gestora, igual que siempre: ni filtro ni peso', async () => {
    filas = [{ total: 0, convertido: 0 }];
    await overview({ projectIds: [1], from: '2026-10-12', to: '2026-10-18' });
    for (const { sql, params } of consultas) {
      expect(sql).not.toMatch(/responsable_id = \$/);
      expect(sql).not.toMatch(/conversion_reparto/);
      expect(params).not.toContain(7);
    }
    expect(consultas.find((c) => /as ventas_brutas/.test(c.sql)).sql).toMatch(/COUNT\(\*\)::int as total/);
  });

  it('cada consulta usa todos sus parámetros (Postgres rechaza uno de más)', async () => {
    for (const extra of [{}, { from: '2026-10-12' }, { from: '2026-10-12', to: '2026-10-18' }]) {
      for (const asesora of [{}, { asesoraId: 7 }]) {
        for (const ambito of [{ projectIds: [1] }, {}]) {
          consultas.length = 0;
          filas = [{ total: 0, convertido: 0 }];
          await overview({ ...ambito, ...extra, ...asesora });
          for (const { sql, params } of consultas) {
            const usados = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
            for (let k = 1; k <= params.length; k++) expect(usados.has(k), `falta $${k} en ${sql.slice(0, 60)}`).toBe(true);
          }
        }
      }
    }
  });
});

describe('el detalle de cada caja (lo que se abre al pulsar)', () => {
  it('filtra por la misma caja que la tabla, con el periodo del mes recortado al rango', async () => {
    await detalleMetrica({ projectIds: [1], from: '2026-10-12', to: '2026-10-18', mes: '2026-10', tipo: 'cobros-anteriores', base: 'cobro', asesoraId: 7 });
    const { sql, params } = consultas[0];
    expect(params).toEqual([[1], '2026-10-12', '2026-10-18', [7]]);
    expect(sql).toMatch(/END\) = 'anteriores'/);
    expect(sql).toMatch(/ROUND\(cp\.importe \* r\.peso, 2\) AS importe/);
  });

  it('el mes entero cuando el rango lo cubre, y «sin» es lo que no tiene gestora', async () => {
    await detalleMetrica({ projectIds: [1], from: '2026-01-01', to: '2026-12-31', mes: '2026-02', tipo: 'cobros-cuotas', base: 'cerrado', asesoraId: 'sin' });
    const { sql, params } = consultas[0];
    expect(params).toEqual([[1], '2026-02-01', '2026-02-28']);
    expect(sql).toMatch(/r\.vendedora_id IS NULL/);
    expect(sql).toMatch(/END\) = 'cuotas'/);
    expect(sql).toMatch(/GREATEST\(cp\.fecha/);
  });
});
