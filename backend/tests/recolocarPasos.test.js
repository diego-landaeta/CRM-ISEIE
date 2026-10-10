import { describe, it, expect, vi, beforeEach } from 'vitest';

// Diego, 10/10: «en ACADEMIA IA ayer estaba al día y hoy 11». Las fechas de los
// pasos no se movían: un contacto tardío cerraba un paso y el siguiente seguía
// con su fecha de septiembre. Ahora, cuando entra un contacto (o se marca un
// paso a mano), la agenda que queda se recoloca desde él.

const consultas = [];
vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (/INSERT INTO lead_interactions/.test(sql)) return { rows: [{ id: 1, lead_id: params[0] }] };
    if (/UPDATE lead_steps\s+SET estado = COALESCE/.test(sql)) return { rows: [{ id: 9, lead_id: 42, estado: params[1] }] };
    if (/WITH abiertos AS/.test(sql)) return { rows: [{ lead_id: 42 }, { lead_id: 42 }] };
    return { rows: [] };
  }),
  getClient: vi.fn(),
}));

const { recolocarPasos } = await import('../src/shared/utils/recolocarPasos.js');
const leadModel = await import('../src/modules/leads/lead.model.js');
const proceso = await import('../src/modules/proceso/proceso.model.js');
const recolocaciones = () => consultas.filter((c) => /WITH abiertos AS/.test(c.sql));

beforeEach(() => { consultas.length = 0; });

describe('la consulta que recoloca', () => {
  it('sin personas no consulta nada', async () => {
    expect(await recolocarPasos([])).toBe(0);
    expect(await recolocarPasos([null, 'x', -3])).toBe(0);
    expect(consultas).toHaveLength(0);
  });
  it('cuenta personas, no pasos movidos', async () => {
    expect(await recolocarPasos([42])).toBe(1);
  });
  it('solo hacia delante, desde la última actividad y sin tocar los pasos cerrados', async () => {
    await recolocarPasos([42]);
    const { sql } = recolocaciones()[0];
    expect(sql).toMatch(/m\.dias > 0/); // nunca hacia atrás
    expect(sql).toMatch(/AND NOT \(/); // el paso abierto: el primero que NO cierran sus contactos
    expect(sql).toMatch(/li\.tipo <> 'nota'/); // una nota no es un contacto
    expect(sql).toMatch(/h\.estado = 'hecho'/); // marcar a mano también cuenta como actividad
    expect(sql).toMatch(/ultima_actividad IS NOT NULL/); // sin actividad no se mueve nada
    expect(sql).toMatch(/ls\.estado = 'pendiente'\s+AND ls\.orden >= m\.orden/); // solo el abierto y los que le siguen
  });
  it('usa el cliente de la transacción si se le da', async () => {
    const db = { query: vi.fn(async () => ({ rows: [] })) };
    await recolocarPasos([7], db);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(recolocaciones()).toHaveLength(0);
  });
});

describe('cuándo se recoloca', () => {
  it('al apuntar un contacto', async () => {
    await leadModel.createInteraction(42, 'whatsapp', 'hola', 3, null);
    expect(recolocaciones()).toHaveLength(1);
    expect(recolocaciones()[0].params[0]).toEqual([42]);
  });
  it('una nota no recoloca nada', async () => {
    await leadModel.createInteraction(42, 'nota', 'apunte', 3, null);
    expect(recolocaciones()).toHaveLength(0);
  });
  it('al marcar un paso a mano', async () => {
    await proceso.ajustarPaso(9, { estado: 'hecho' }, 3);
    expect(recolocaciones()).toHaveLength(1);
  });
  it('si se pone una fecha a mano, manda esa', async () => {
    await proceso.ajustarPaso(9, { estado: 'hecho', fecha_prevista: '2026-10-20' }, 3);
    expect(recolocaciones()).toHaveLength(0);
  });
  it('saltar un paso no recoloca', async () => {
    await proceso.ajustarPaso(9, { estado: 'saltado' }, 3);
    expect(recolocaciones()).toHaveLength(0);
  });
});
