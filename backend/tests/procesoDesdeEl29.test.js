import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Diego, 30/09/2026: «todos los clientes desde el 29 en adelante es que entran
// en el proceso, no los anteriores». Los de antes no salen en la cola ni tienen
// pasos en la ficha.

let filas = [];
const consultas = [];

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: filas }; }),
}));

const { EN_EL_PROCESO, inicioDelProceso } = await import('../src/shared/utils/enElProceso.js');
const Proceso = await import('../src/modules/proceso/proceso.model.js');

const REGLA = "COALESCE(l.fecha_solicitud, l.created_at) >= TIMESTAMPTZ '2026-09-29 00:00 Europe/Madrid'";
const sql = () => consultas.map((c) => c.sql).join('\n');

beforeEach(() => { filas = []; consultas.length = 0; delete process.env.PROCESO_INICIO; });
afterEach(() => { delete process.env.PROCESO_INICIO; });

describe('la fecha de inicio', () => {
  it('es el 29/09/2026 si no se dice otra cosa', () => {
    expect(inicioDelProceso()).toBe('2026-09-29');
    expect(EN_EL_PROCESO('l')).toContain(REGLA);
  });

  it('se puede mover desde el .env', () => {
    process.env.PROCESO_INICIO = '2026-10-01';
    expect(EN_EL_PROCESO('x')).toContain("COALESCE(x.fecha_solicitud, x.created_at) >= TIMESTAMPTZ '2026-10-01 00:00 Europe/Madrid'");
  });

  it('una fecha mal escrita no entra en el SQL: se queda la de siempre', () => {
    process.env.PROCESO_INICIO = "2026-01-01' OR 1=1 --";
    expect(inicioDelProceso()).toBe('2026-09-29');
    expect(EN_EL_PROCESO()).not.toContain('OR 1=1');
  });
});

describe('los de antes del 29/09 quedan fuera del proceso', () => {
  it('no se les escribe agenda', async () => {
    await Proceso.planificarPasosDeLead(7);
    expect(sql()).toContain('INSERT INTO lead_steps');
    expect(sql()).toContain(REGLA);
  });

  it('la ficha no les enseña pasos', async () => {
    await Proceso.pasosDeLead(7);
    expect(sql()).toContain(REGLA);
  });

  it('no salen en la cola del día', async () => {
    await Proceso.colaDelDia({ projectIds: [1] });
    expect(sql()).toContain(REGLA);
  });

  it('ni en su desplegable de formaciones', async () => {
    await Proceso.colaDelDia({ projectIds: [1], soloFormaciones: true });
    expect(sql()).toContain(REGLA);
  });

  it('ni en los contadores (campana, resumen diario, «para hoy»)', async () => {
    filas = [{ atrasados: 0, hoy: 0, manana: 0, esta_semana: 0 }];
    await Proceso.resumenDeLaCola({ projectIds: [1] });
    expect(sql()).toContain(REGLA);
  });
});
