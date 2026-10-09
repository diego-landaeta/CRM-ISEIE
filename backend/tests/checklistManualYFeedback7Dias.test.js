import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

// Diego, 09/10:
//  · «cuando hacen el seguimiento 5, 6 o quieren darle al check… no funciona» →
//    «que sea manual pero que aparezca por hacer».
//  · «el correo del feedback… solamente a los 7 días que no haya interacción».

const consultas = [];
let filas = [];
vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => { consultas.push({ sql, params }); return { rows: filas }; }),
}));

const proceso = await import('../src/modules/proceso/proceso.model.js');
const feedback = await import('../src/modules/feedback/feedback.model.js');

beforeEach(() => { consultas.length = 0; filas = []; });

describe('la checklist del proceso es manual', () => {
  it('un paso sale hecho SOLO si se marcó a mano; el contacto apuntado va aparte', async () => {
    await proceso.pasosDeLead(7);
    const sql = consultas[0].sql;
    expect(sql).toMatch(/ls\.estado = 'hecho' AS hecho,/);
    expect(sql).toMatch(/AS con_contacto/);
    expect(sql).not.toMatch(/\(ls\.estado = 'hecho' OR/);
    expect(sql).toMatch(/COALESCE\(s\.nombre, 'Seguimiento ' \|\| ls\.orden\) AS nombre/);
  });
  it('«+ Seguimiento» añade el siguiente número, por hacer, para hoy si no se dice fecha', async () => {
    filas = [{ id: 99, lead_id: 7, clave: 'seguimiento_5', orden: 5, estado: 'pendiente' }];
    const r = await proceso.anadirSeguimiento(7);
    const { sql, params } = consultas[0];
    expect(sql).toMatch(/INSERT INTO lead_steps/);
    expect(sql).toMatch(/'seguimiento_' \|\| \(COALESCE\(MAX\(ls\.orden\), 0\) \+ 1\)/);
    expect(sql).toMatch(/COALESCE\(\$2::date, CURRENT_DATE\), 'pendiente'/);
    expect(params).toEqual([7, null]);
    expect(r.orden).toBe(5);
  });
  it('marcar a mano guarda quién y cuándo', async () => {
    await proceso.ajustarPaso(3, { estado: 'hecho' }, 11);
    expect(consultas[0].sql).toMatch(/hecho_at\s+= CASE WHEN \$2 = 'hecho' THEN NOW\(\)/);
    expect(consultas[0].params).toEqual([3, 'hecho', null, null, 11]);
  });
  it('la ruta del seguimiento existe', () => {
    const rutas = fs.readFileSync(new URL('../src/modules/proceso/proceso.routes.js', import.meta.url), 'utf8');
    expect(rutas).toMatch(/router\.post\('\/lead\/:leadId\/seguimiento', ctrl\.anadirSeguimientoDeLead\)/);
  });
});

describe('el correo de feedback sale solo tras 7 días sin interacción', () => {
  it('cuenta desde la ÚLTIMA interacción, de cualquier tipo, y no desde el primer contacto', async () => {
    await feedback.candidatosDelDia7({ tope: 5, maxDias: 30, inicio: '2026-09-29' });
    const sql = consultas[0].sql;
    expect(sql).toMatch(/MAX\(li\.fecha\)::date AS ultima/);
    expect(sql).toMatch(/pc\.ultima BETWEEN CURRENT_DATE - \$2::int AND CURRENT_DATE - 7/);
    expect(sql).not.toMatch(/pc\.primer_contacto BETWEEN/);
    expect(sql).toMatch(/pc\.primer_contacto >= \$3::date/);
  });
  it('descartar a alguien ya no dispara el correo', () => {
    const srv = fs.readFileSync(new URL('../src/modules/leads/lead.service.js', import.meta.url), 'utf8');
    expect(srv).not.toMatch(/pedirFeedback\(leadId, 'descarte'/);
  });
});
