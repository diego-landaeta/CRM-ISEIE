import { describe, it, expect, vi, beforeEach } from 'vitest';

// El ranking de gestoras, por lo COBRADO (Diego, 08/10: «en los reportes el
// ranking de gestora es por lo cobrado»). Del 30/09 al 08/10 fue por lo
// facturado: lo facturado sigue saliendo, pero ya no ordena.

let filas = [];
const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: filas }; }),
}));

const { miPuesto } = await import('../src/modules/reports/report.model.js');

const fila = (id, nombre, { ventas = 0, cobrado = 0, facturado = 0, leads = 0, mes = '2026-09' } = {}) => ({
  mes, asesora_id: id, asesora: nombre, leads, ventas, vendido: 0, cobrado, facturado,
});

beforeEach(() => { filas = []; consultas.length = 0; });

describe('el puesto', () => {
  it('va por lo cobrado, aunque otra haya cerrado más ventas o facturado más', async () => {
    filas = [
      fila(1, 'Dayana', { ventas: 23, cobrado: 5424, facturado: 9000 }),
      fila(2, 'Ana', { ventas: 21, cobrado: 10682, facturado: 4000 }),
      fila(3, 'Yolanda', { ventas: 12, cobrado: 5171, facturado: 12000 }),
    ];
    const r = await miPuesto({ userId: 1, projectIds: [1], from: '2026-09-01', to: '2026-09-30', esJefe: true });
    expect(r.tabla.map((f) => f.nombre)).toEqual(['Ana', 'Dayana', 'Yolanda']);
    expect(r.puesto).toBe(2);
    expect(r.cobrado).toBe(5424);
    expect(r.facturado).toBe(9000);
  });

  it('lo que falta para subir y la primera, en euros cobrados', async () => {
    filas = [fila(1, 'Dayana', { ventas: 23, cobrado: 5424 }), fila(2, 'Ana', { ventas: 21, cobrado: 10682 })];
    const r = await miPuesto({ userId: 1, projectIds: [1] });
    expect(r.faltan_para_subir).toBe(5258);
    expect(r.mejor_cobrado).toBe(10682);
    expect(r.cobrado_equipo).toBe(16106);
  });

  it('suma varios meses y redondea al céntimo el reparto de una venta compartida', async () => {
    filas = [
      fila(1, 'Dayana', { cobrado: 100.005, mes: '2026-08' }),
      fila(1, 'Dayana', { cobrado: 200.004, mes: '2026-09' }),
      fila(2, 'Ana', { cobrado: 300 }),
    ];
    const r = await miPuesto({ userId: 1, projectIds: [1], esJefe: true });
    expect(r.tabla.map((f) => [f.nombre, f.cobrado])).toEqual([['Dayana', 300.01], ['Ana', 300]]);
    expect(r.faltan_para_subir).toBeNull();
  });

  it('en empate de cobrado, manda el número de ventas', async () => {
    filas = [fila(1, 'Dayana', { ventas: 2, cobrado: 500 }), fila(2, 'Ana', { ventas: 5, cobrado: 500 })];
    const r = await miPuesto({ userId: 1, projectIds: [1], esJefe: true });
    expect(r.tabla.map((f) => f.nombre)).toEqual(['Ana', 'Dayana']);
  });

  it('una gestora ve su puesto, no la tabla de las demás', async () => {
    filas = [fila(1, 'Dayana', { cobrado: 5424 }), fila(2, 'Ana', { cobrado: 10682 })];
    const r = await miPuesto({ userId: 1, projectIds: [1] });
    expect(r.tabla).toBeNull();
    expect(r.puesto).toBe(2);
  });
});

describe('la consulta de lo facturado (sigue saliendo, ya no ordena)', () => {
  it('cuenta facturas y abonos emitidos, no proformas, borradores ni anuladas', async () => {
    await miPuesto({ userId: 1, projectIds: [1, 2], from: '2026-09-01', to: '2026-09-30', esJefe: true });
    const { sql } = consultas[0];
    expect(sql).toMatch(/facturas_mes AS/);
    expect(sql).toMatch(/i\.tipo IN \('normal', 'rectificativa'\)/);
    expect(sql).toMatch(/i\.estado NOT IN \('cancelada', 'borrador'\)/);
    expect(sql).toMatch(/SUM\(i\.total \* r\.peso\)/);
    expect(sql).toMatch(/date_trunc\('month', i\.fecha_emision\)/);
  });

  it('los parámetros van numerados sin huecos ni de más, con y sin gestora', async () => {
    for (const extra of [{}, { asesoraId: 7 }]) {
      consultas.length = 0;
      await miPuesto({ userId: 1, projectIds: [1, 2], from: '2026-09-01', to: '2026-09-30', ...extra });
      const { sql, params } = consultas[0];
      const usados = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      expect(Math.max(...usados)).toBe(params.length);
      for (let k = 1; k <= params.length; k++) expect(usados.has(k), `falta $${k}`).toBe(true);
    }
  });
});
