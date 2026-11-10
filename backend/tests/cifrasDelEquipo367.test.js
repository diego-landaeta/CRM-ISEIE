import { describe, it, expect, vi, beforeEach } from 'vitest';

// #367 (gemela de diego-landaeta/CRM#534) · «El equipo este mes»: cada importe con SU recuento.
//
// Las cifras son las de octubre del 360 (Manuel): 82 cobros y 18.047,82 €
// cobrados; aquí pasaba igual. Prospectos decía «18.048 € cobrados · 43 ventas»: el
// importe era lo cobrado y el 43, las ventas NUEVAS del mes (columna Vendido).
// No había en ningún sitio cuántos cobros eran, así que el número que iba con
// lo cobrado no se podía poner.
//
// ANTES del arreglo `miPuesto` no devolvía `cobros`: estas pruebas fallan.

let filas = [];
const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: filas }; }),
}));

const { miPuesto, asesorasPorMes } = await import('../src/modules/reports/report.model.js');

const fila = (id, nombre, x = {}) => ({
  mes: 'rango', asesora_id: id, asesora: nombre,
  leads: 0, ventas: 0, vendido: 0, facturado: 0, pendiente: 0,
  cobrado: 0, cobros: 0, cobrado_del_periodo: 0, cobrado_anteriores: 0, cobrado_en_cuotas: 0,
  ventas_anteriores: 0, anteriores_grandes: [],
  ...x,
});

// Octubre, simplificado: tres gestoras y lo que no es de nadie. Una venta
// compartida entre Ana y Dayana reparte su cobro a medias (0,5 y 0,5).
const OCTUBRE = () => [
  fila(7, 'Dayana', { leads: 120, ventas: 16, vendido: 9000, cobrado: 9318.28, cobros: 38.5, cobrado_del_periodo: 9318.28 }),
  fila(6, 'Ana', { leads: 90, ventas: 12, vendido: 6000, cobrado: 4243.04, cobros: 26.5, cobrado_del_periodo: 4243.04 }),
  fila(14, 'Mar', { leads: 30, ventas: 3, vendido: 737.5, cobrado: 737.5, cobros: 3, cobrado_del_periodo: 737.5 }),
  fila(null, '— sin asesora —', { leads: 10, ventas: 12, vendido: 8446.5, cobrado: 3749, cobros: 14, cobrado_del_periodo: 3749 }),
];

beforeEach(() => { filas = []; consultas.length = 0; });

describe('cuántos cobros van con lo cobrado', () => {
  it('el Total lleva los 82 cobros de octubre, «Sin gestora» incluida', async () => {
    filas = OCTUBRE();
    const r = await miPuesto({ userId: 1, projectIds: [1], from: '2026-10-01', to: '2026-10-31', esJefe: true });
    expect(r.total.cobros).toBe(82);
    expect(r.total.cobrado).toBeCloseTo(18047.82, 2);
    // Y no es el número de ventas nuevas: ese va aparte, con su nombre.
    expect(r.total.ventas).toBe(43);
    expect(r.sin_gestora.cobros).toBe(14);
  });

  it('cada gestora, con su parte de los cobros compartidos', async () => {
    filas = OCTUBRE();
    const r = await miPuesto({ userId: 7, projectIds: [1], from: '2026-10-01', to: '2026-10-31', esJefe: true });
    expect(r.tabla.find((f) => f.nombre === 'Dayana').cobros).toBe(38.5);
    expect(r.tabla.find((f) => f.nombre === 'Ana').cobros).toBe(26.5);
    // La gestora también lo recibe de sí misma (su panel dice «N cobros»).
    expect(r.cobros).toBe(38.5);
  });

  it('una gestora ve sus cobros, pero no la tabla ni el total', async () => {
    filas = OCTUBRE();
    const r = await miPuesto({ userId: 6, projectIds: [1], from: '2026-10-01', to: '2026-10-31', esJefe: false });
    expect(r.cobros).toBe(26.5);
    expect(r.tabla).toBeNull();
    expect(r.total).toBeNull();
  });

  it('la consulta cuenta los cobros (con su peso) en la misma caja que lo cobrado', async () => {
    await asesorasPorMes({ projectIds: [1], from: '2026-10-01', to: '2026-10-31', agrupar: 'rango' });
    const sql = consultas.map((c) => c.sql).join('\n');
    expect(sql).toMatch(/COALESCE\(SUM\(peso\), 0\)::float8 AS cobros\b/);
    expect(sql).toMatch(/COALESCE\(cm\.cobros, 0\) AS cobros\b/);
  });
});

describe('las dos tasas', () => {
  it('la media de las gestoras deja fuera «Sin gestora»; la del Total, no', async () => {
    filas = OCTUBRE();
    const r = await miPuesto({ userId: 1, projectIds: [1], from: '2026-10-01', to: '2026-10-31', esJefe: true });
    // 31 ventas / 240 prospectos de las gestoras = 12,9 %; con «Sin gestora», 43 / 250 = 17,2 %.
    expect(r.tasa_equipo).toBe(12.9);
    expect(r.total.tasa).toBe(17.2);
  });
});
