import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';

// Los permisos salen del catálogo (#423): sin base, el resolver de verdad con
// las personas de cada `req` (tests/helpers/permisosSinBase.js).
vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
const { registrar } = await import('./helpers/permisosSinBase.js');

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
    // Con su permiso del catálogo delante (#423): «Trabajar la cola».
    expect(rutas).toMatch(/router\.post\('\/lead\/:leadId\/seguimiento', puede\('proceso\.trabajar'\), ctrl\.anadirSeguimientoDeLead\)/);
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
// Diego, 13/10: «aparecen atrasados de muy atrás». La ficha
// decía «hace 31 días» de un paso que ya cubrió un contacto; la cola, 3 días.
describe('la ficha no da por vencido un paso que ya cubrió un contacto', () => {
  it('con contacto no vence; sin contacto y con fecha pasada, sí', async () => {
    filas = [
      { id: 1, orden: 2, estado: 'pendiente', hecho: false, con_contacto: true, dias_de_retraso: 31 },
      { id: 2, orden: 4, estado: 'pendiente', hecho: false, con_contacto: false, dias_de_retraso: 3 },
      { id: 3, orden: 5, estado: 'pendiente', hecho: false, con_contacto: false, dias_de_retraso: -2 },
      { id: 4, orden: 1, estado: 'hecho', hecho: true, con_contacto: false, dias_de_retraso: 40 },
    ];
    const pasos = await proceso.pasosDeLead(3676);
    expect(pasos.map((p) => [p.id, p.vencido])).toEqual([[1, false], [2, true], [3, false], [4, false]]);
  });
});
